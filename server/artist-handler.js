const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const db = require('./db');
const sources = require('./sources');

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('[artist-handler] sharp not available, image resizing disabled');
}

// Ensure DB initialized
try { db.init(); } catch (e) { /* ignore */ }

// Domains that support CORS - use redirect for faster loading
const CORS_FRIENDLY_DOMAINS = [
  'coverartarchive.org',
  'upload.wikimedia.org',
  'commons.wikimedia.org'
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

// Safe response helpers to avoid "headers already sent" errors
const safeJson = (res, obj) => {
  if (!res || res.headersSent || res.finished) return;
  try { res.json(obj); } catch (e) {}
};
const safeStatusJson = (res, status, obj) => {
  if (!res || res.headersSent || res.finished) return;
  try { res.status(status).json(obj); } catch (e) {}
};

const proxyImage = (url, response, maxSize) => {
  const protocol = url.startsWith('https') ? https : http;
  const req = protocol.get(url, { headers: { 'User-Agent': 'hqpwv/1.0' } }, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      const contentType = res.headers['content-type'] || 'image/jpeg';
      
      if (maxSize && sharp && (contentType.startsWith('image/jpeg') || contentType.startsWith('image/png') || contentType.startsWith('image/webp'))) {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          // Ensure we don't attempt to write if response already finished
          if (response.headersSent || response.finished) return;
          sharp(buffer)
            .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer((err, data, info) => {
              if (response.headersSent || response.finished) return;
              if (err) {
                console.error('[artist-handler] sharp resize error:', err.message);
                try {
                  response.set('Content-Type', contentType);
                  response.set('Cache-Control', 'public, max-age=86400');
                  response.send(buffer);
                } catch (e) {}
                return;
              }
              try {
                response.set('Content-Type', 'image/jpeg');
                response.set('Cache-Control', 'public, max-age=86400');
                response.send(data);
              } catch (e) {}
            });
        });
      } else {
        if (response.headersSent || response.finished) return;
        try {
          response.set('Content-Type', contentType);
          response.set('Cache-Control', 'public, max-age=86400');
        } catch (e) {}
        // Pipe will end the response when source ends
        res.pipe(response);
      }
    } else {
      if (!response.headersSent && !response.finished) {
        try { safeStatusJson(response, 404, { error: 'image_fetch_failed', status: res.statusCode }); } catch (e) {}
      }
    }
  });
  req.on('error', (err) => {
    console.error('[artist-handler] proxyImage error:', err.message);
    if (!response.headersSent && !response.finished) {
      try { safeStatusJson(response, 404, { error: 'image_fetch_failed', message: err.message }); } catch (e) {}
    }
  });
  req.setTimeout(10000, () => {
    req.destroy();
    if (!response.headersSent && !response.finished) {
      try { safeStatusJson(response, 504, { error: 'image_fetch_timeout' }); } catch (e) {}
    }
  });
};

const doGet = (request, response) => {
  response.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  response.set('Pragma', 'no-cache');
  response.set('Expires', '0');

  // Support fetching a single release by id for frontend metadata enrichment
  if (request.query['getRelease'] !== undefined) {
    const releaseId = request.query['release_id'];
    if (!releaseId) { safeStatusJson(response, 400, { error: 'missing_release_id' }); return; }
    sources.fetchReleaseById(releaseId, (err, rel) => {
      if (err) { safeStatusJson(response, 500, { error: 'fetch_error' }); return; }
      safeJson(response, { release: rel });
    });
    return;
  }

  const id = request.query['id'];
  if (!id) {
    // support lookup by name
    const name = request.query['name'];
    if (name) {
      db.getArtistByName(name, (err, artist) => {
        if (err) { console.error('[artist-handler] db error', err); safeStatusJson(response, 500, { error: 'db_error' }); return; }
        if (!artist) { safeStatusJson(response, 404, { error: 'not_found' }); return; }
        safeJson(response, { artist });
      });
      return;
    }
    safeStatusJson(response, 400, { error: 'missing_required_param' });
    return;
  }

  if (request.query['get'] !== undefined) {
    db.getArtistById(id, (err, artist) => {
      if (err) {
        safeStatusJson(response, 500, { error: 'db_error' });
        return;
      }
      if (!artist) {
          db.getArtistByName(id, (err2, artist2) => {
             if (err2 || !artist2) {
               safeStatusJson(response, 404, { error: 'not_found' });
             } else {
               const hasDiscography = artist2.discography && artist2.discography.length > 0;
               safeJson(response, { artist: artist2, more_albums_available: hasDiscography });
             }
          });
          return;
        }
        const hasDiscography = artist.discography && artist.discography.length > 0;
        safeJson(response, { artist, more_albums_available: hasDiscography });
    });
    return;
  }

  safeStatusJson(response, 400, { error: 'missing_required_action' });
};

const doPost = (request, response) => {
  const id = request.query['id'];
    console.log('[artist-handler] POST', { query: request.query, body: request.body });
    if (!id) {
      safeStatusJson(response, 400, { error: 'missing_required_param' });
      return;
    }

  if (request.query['setDefaultImage'] !== undefined) {
    const image_id = request.body && request.body.image_id;
    console.log('[artist-handler] setDefaultImage called:', { id, image_id });
    if (!image_id) {
        safeStatusJson(response, 400, { error: 'missing_required_sub_param' });
      return;
    }
    db.setDefaultImage(id, image_id, (err, changes) => {
        if (err) console.error('[artist-handler] setDefaultImage error', err);
      if (err) {
          safeStatusJson(response, 500, { error: 'db_error' });
        return;
      }
      console.log('[artist-handler] setDefaultImage result:', { changes });
        safeJson(response, { result: true, changes: changes });
    });
    return;
  }

  if (request.query['moreReleases'] !== undefined) {
    // Trigger fetching additional releases for this artist and append them.
    sources.fetchAndAppendMoreReleases(id, (err, added) => {
      if (err) {
        console.error('[artist-handler] moreReleases error', err);
          safeStatusJson(response, 500, { error: 'fetch_error' });
        return;
      }
        safeJson(response, { added: added });
    });
    return;
  }

    safeStatusJson(response, 400, { error: 'missing_required_action' });
};

const doImage = (request, response) => {
  const artistId = request.query['artist_id'];
  const imageId = request.query['image_id'];
  const forBackground = request.query['background'] !== undefined;
  const maxBgSize = 640;
  
  if (!artistId || !imageId) {
    safeStatusJson(response, 400, { error: 'missing_required_param' });
    return;
  }

  const serveImage = (url, isLocal = false) => {
    if (isLocal) {
      try {
        const p = path.resolve(url);
        if (fs.existsSync(p)) {
          if (forBackground && sharp) {
            sharp(p)
              .resize(maxBgSize, maxBgSize, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 })
              .toBuffer((err, data) => {
                if (err) {
                  response.sendFile(p);
                } else {
                  response.set('Content-Type', 'image/jpeg');
                  response.set('Cache-Control', 'public, max-age=86400');
                  response.send(data);
                }
              });
          } else {
            response.sendFile(p);
          }
          return true;
        }
      } catch (e) {}
      return false;
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (needsProxy(url)) {
        proxyImage(url, response, forBackground ? maxBgSize : null);
      } else {
        if (forBackground && sharp) {
          proxyImage(url, response, maxBgSize);
        } else {
          response.redirect(url);
        }
      }
      return true;
    }
    return false;
  };

  db.getArtistById(artistId, (err, artist) => {
    if (err) {
      safeStatusJson(response, 500, { error: 'db_error' });
      return;
    }
    if (!artist) {
      safeStatusJson(response, 404, { error: 'artist_not_found' });
      return;
    }
    const imgs = artist.images || [];
    let image = imgs.find(i => i.id == imageId);

    if (!image) {
      try {
        const disc = artist.discography || [];
        if (imageId && imageId.indexOf(artistId + '-rel-') === 0) {
          const relId = imageId.substring((artistId + '-rel-').length);
          const rel = disc.find(r => String(r.id) === String(relId));
          if (rel && rel.cover_url) {
            if (serveImage(rel.cover_url)) return;
          }
        }
      } catch (e) {}
      safeStatusJson(response, 404, { error: 'image_not_found' });
      return;
    }

    let url = image.url || '';
    if (url.includes('lastfm.freetls.fastly.net/i/u/')) {
      // Automatically upgrade Last.fm thumbnails/resized images to original quality
      url = url.replace(/\/i\/u\/[^\/]+\//, '/i/u/_/');
    }
    
    if (!serveImage(url)) {
      safeStatusJson(response, 404, { error: 'image_url_invalid' });
    }
  });
};

module.exports = {
  doGet,
  doPost,
  doImage
};
