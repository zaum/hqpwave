const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const db = require('./db');
const sources = require('./sources');

// Ensure DB initialized
try { db.init(); } catch (e) { /* ignore */ }

// Domains that support CORS - use redirect for faster loading
const CORS_FRIENDLY_DOMAINS = [
  'coverartarchive.org',
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'spotify.com',
  'i.scdn.co'
];

const needsProxy = (url) => {
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    return !CORS_FRIENDLY_DOMAINS.some(d => host.endsWith(d));
  } catch (e) {
    return true;
  }
};

const proxyImage = (url, response) => {
  const protocol = url.startsWith('https') ? https : http;
  const req = protocol.get(url, { headers: { 'User-Agent': 'hqpwv/1.0' } }, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      response.set('Content-Type', res.headers['content-type'] || 'image/jpeg');
      response.set('Cache-Control', 'public, max-age=86400');
      res.pipe(response);
    } else {
      response.status(404).json({ error: 'image_fetch_failed', status: res.statusCode });
    }
  });
  req.on('error', (err) => {
    console.error('[artist-handler] proxyImage error:', err.message);
    response.status(404).json({ error: 'image_fetch_failed', message: err.message });
  });
  req.setTimeout(10000, () => {
    req.destroy();
    response.status(504).json({ error: 'image_fetch_timeout' });
  });
};

const doGet = (request, response) => {
  response.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  response.set('Pragma', 'no-cache');
  response.set('Expires', '0');

  // Support fetching a single release by id for frontend metadata enrichment
  if (request.query['getRelease'] !== undefined) {
    const releaseId = request.query['release_id'];
    if (!releaseId) { response.status(400).json({ error: 'missing_release_id' }); return; }
    sources.fetchReleaseById(releaseId, (err, rel) => {
      if (err) { response.status(500).json({ error: 'fetch_error' }); return; }
      response.json({ release: rel });
    });
    return;
  }

  const id = request.query['id'];
  if (!id) {
    // support lookup by name
    const name = request.query['name'];
    if (name) {
      db.getArtistByName(name, (err, artist) => {
        if (err) { console.error('[artist-handler] db error', err); response.status(500).json({ error: 'db_error' }); return; }
        if (!artist) { response.status(404).json({ error: 'not_found' }); return; }
        response.json({ artist });
      });
      return;
    }
    response.status(400).json({ error: 'missing_required_param' });
    return;
  }

  if (request.query['get'] !== undefined) {
    db.getArtistById(id, (err, artist) => {
      if (err) {
        response.status(500).json({ error: 'db_error' });
        return;
      }
      if (!artist) {
          db.getArtistByName(id, (err2, artist2) => {
             if (err2 || !artist2) {
                response.status(404).json({ error: 'not_found' });
             } else {
                const hasDiscography = artist2.discography && artist2.discography.length > 0;
                response.json({ artist: artist2, more_albums_available: hasDiscography });
             }
          });
          return;
        }
        const hasDiscography = artist.discography && artist.discography.length > 0;
        response.json({ artist, more_albums_available: hasDiscography });
    });
    return;
  }

  response.status(400).json({ error: 'missing_required_action' });
};

const doPost = (request, response) => {
  const id = request.query['id'];
    console.log('[artist-handler] POST', { query: request.query, body: request.body });
  if (!id) {
    response.status(400).json({ error: 'missing_required_param' });
    return;
  }

  if (request.query['setDefaultImage'] !== undefined) {
    const image_id = request.body && request.body.image_id;
    if (!image_id) {
      response.status(400).json({ error: 'missing_required_sub_param' });
      return;
    }
    db.setDefaultImage(id, image_id, (err, changes) => {
        if (err) console.error('[artist-handler] setDefaultImage error', err);
      if (err) {
        response.status(500).json({ error: 'db_error' });
        return;
      }
      response.json({ result: true, changes: changes });
    });
    return;
  }

  if (request.query['moreReleases'] !== undefined) {
    // Trigger fetching additional releases for this artist and append them.
    sources.fetchAndAppendMoreReleases(id, (err, added) => {
      if (err) {
        console.error('[artist-handler] moreReleases error', err);
        response.status(500).json({ error: 'fetch_error' });
        return;
      }
      response.json({ added: added });
    });
    return;
  }

  response.status(400).json({ error: 'missing_required_action' });
};

const doImage = (request, response) => {
  // Serve or redirect to an image for an artist
  const artistId = request.query['artist_id'];
  const imageId = request.query['image_id'];
  if (!artistId || !imageId) {
    response.status(400).json({ error: 'missing_required_param' });
    return;
  }

  db.getArtistById(artistId, (err, artist) => {
    if (err) {
      response.status(500).json({ error: 'db_error' });
      return;
    }
    if (!artist) {
      response.status(404).json({ error: 'artist_not_found' });
      return;
    }
    const imgs = artist.images || [];
    let image = imgs.find(i => i.id == imageId);

    // If not found, support synthetic release image ids of the form
    // "<artistId>-rel-<releaseId>" by looking up the release in the
    // stored discography and using its cover_url if available.
    if (!image) {
      try {
        const disc = artist.discography || [];
        if (imageId && imageId.indexOf(artistId + '-rel-') === 0) {
          const relId = imageId.substring((artistId + '-rel-').length);
          const rel = disc.find(r => r && String(r.id) === String(relId));
          if (rel && rel.cover_url) {
            if (needsProxy(rel.cover_url)) {
              proxyImage(rel.cover_url, response);
            } else {
              response.redirect(rel.cover_url);
            }
            return;
          }
        }
      } catch (e) {
        // fall through to image_not_found below
      }
      response.status(404).json({ error: 'image_not_found' });
      return;
    }

    const url = image.url || '';
    // If URL is a local file path that exists, serve it
    try {
      if (url.startsWith('/') || /^[a-zA-Z]:\\/.test(url)) {
        const p = path.resolve(url);
        if (fs.existsSync(p)) {
          response.sendFile(p);
          return;
        }
      }
    } catch (e) {
      // fallthrough
    }

    // For remote URLs: redirect for CORS-friendly, proxy for others
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      if (needsProxy(url)) {
        proxyImage(url, response);
      } else {
        response.redirect(url);
      }
      return;
    }

    response.status(404).json({ error: 'image_url_invalid' });
  });
};

module.exports = {
  doGet,
  doPost,
  doImage
};
