const https = require('https');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const db = require('./db');

// Ensure DB initialized
db.init();

const UA = 'HQPWV/0.1 (https://github.com/zaum/hqpwave)';

const httpGetJson = (url, cb, redirects = 0) => {
  if (redirects > 5) return cb(new Error('too_many_redirects'));
  try {
    const opts = new URL(url);
    const req = https.request(opts, { method: 'GET', headers: { 'User-Agent': UA, 'Accept': 'application/json' }, timeout: 3500 }, (res) => {
      // follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        res.resume();
        return httpGetJson(next, cb, redirects + 1);
      }
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        try {
          if (res.statusCode >= 400) {
            cb(new Error(`HTTP error ${res.statusCode}`), null);
            return;
          }
          cb(null, JSON.parse(data));
        } catch (e) { cb(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); cb(new Error('timeout')); });
    req.on('error', (e) => cb(e));
    req.end();
  } catch (e) {
    cb(e);
  }
};

const musicbrainzCache = new Map();
const musicbrainzQueue = [];
let musicbrainzProcessing = false;

const processMusicBrainzQueue = () => {
  if (musicbrainzProcessing || musicbrainzQueue.length === 0) return;
  musicbrainzProcessing = true;
  const { url, cb } = musicbrainzQueue.shift();
  
  if (musicbrainzCache.has(url)) {
    cb(null, musicbrainzCache.get(url));
    musicbrainzProcessing = false;
    processMusicBrainzQueue();
    return;
  }

  httpGetJson(url, (err, json) => {
    if (err) {
      console.error('[sources] MB error:', { url, err });
    } else if (json) {
      musicbrainzCache.set(url, json);
    }
    
    cb(err, json);
    
    // Respect MusicBrainz rate limit: ~1 request per second
    setTimeout(() => {
      musicbrainzProcessing = false;
      processMusicBrainzQueue();
    }, 1100); 
  });
};

const musicbrainzGet = (url, cb, priority = 0) => {
  musicbrainzQueue.push({ url, cb, priority });
  // Process items in order of priority (higher first), then by queue entry time
  musicbrainzQueue.sort((a, b) => b.priority - a.priority);
  processMusicBrainzQueue();
};

const searchMusicBrainzArtist = (name, cb) => {
  const q = querystring.stringify({ query: `artist:\"${name}\"`, fmt: 'json', limit: 1 });
  const url = `https://musicbrainz.org/ws/2/artist?${q}`;
  console.log('[sources] Searching MusicBrainz:', url);
  musicbrainzGet(url, (err, json) => {
    if (err) {
      console.error('[sources] MusicBrainz error:', err);
      return cb(err);
    }
    const artist = (json && json.artists && json.artists[0]) ? json.artists[0] : null;
    cb(null, artist);
  }, 10); // Priority 10
};

const fetchReleasesForArtist = (mbid, cb) => {
  const q = querystring.stringify({ artist: mbid, fmt: 'json', limit: 100, inc: 'release-groups' });
  const url = `https://musicbrainz.org/ws/2/release?${q}`;
  console.log('[sources] Fetching releases from MusicBrainz:', url);
  musicbrainzGet(url, (err, json) => {
    if (err) {
      console.error('[sources] MusicBrainz releases error:', err);
      return cb(err);
    }
    const releases = (json && json.releases) ? json.releases : [];
    cb(null, releases);
  }, 10); // Priority 10
};

const fetchReleaseById = (releaseId, cb) => {
  if (!releaseId) return cb(new Error('missing_release_id'));
  const url = `https://musicbrainz.org/ws/2/release/${encodeURIComponent(releaseId)}?fmt=json`;
  musicbrainzGet(url, cb, 0); // Priority 0 (background)
};

const fetchCoverArt = (releaseId, releaseGroupId, cb) => {
  const tryFetch = (pathSegment, id, cb2) => {
    if (!id) return cb2(null, null);
    // Use archive.org index.json for reliable access and thumbnail sizes
    const indexUrl = `https://archive.org/download/mbid-${id}/index.json`;
    httpGetJson(indexUrl, (err, json) => {
      if (err) return cb2(null, null);
      if (json && json.images && json.images[0]) {
        const img = json.images[0];
        // Prefer 500px thumbnail for balance of quality and size
        const thumb = (img.thumbnails && (img.thumbnails['500'] || img.thumbnails['250'])) 
          ? (img.thumbnails['500'] || img.thumbnails['250']) 
          : (img.thumbnails && (img.thumbnails.large || img.thumbnails.small))
            ? (img.thumbnails.large || img.thumbnails.small)
            : (img.image || null);
        cb2(null, thumb || img.image || null);
        return;
      }
      cb2(null, null);
    });
  };

  // Try release first, then release-group
  tryFetch('release', releaseId, (err, result) => {
    if (result) return cb(null, result);
    tryFetch('release-group', releaseGroupId, (err2, result2) => {
      return cb(null, result2);
    });
  });
};

const fetchWikipediaSummary = (title, cb) => {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'));
  // Use the query API to get a longer plaintext extract, thumbnail and fullurl
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageimages|info&explaintext=1&piprop=thumbnail&pithumbsize=600&inprop=url&titles=${encoded}&formatversion=2`;
  httpGetJson(url, (err, json) => {
    if (err) return cb(null, null);
    try {
      const page = json.query && json.query.pages && json.query.pages[0] ? json.query.pages[0] : null;
      if (!page) return cb(null, null);
      const extract = page.extract || '';
      const thumbnail = (page.thumbnail && page.thumbnail.source) ? page.thumbnail.source : null;
      const pageUrl = page.fullurl || (`https://en.wikipedia.org/wiki/${encoded}`);
      cb(null, { extract, thumbnail, url: pageUrl });
    } catch (e) { cb(null, null); }
  });
};

const searchWikipediaByName = (name, cb) => {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=1`;
  httpGetJson(url, (err, json) => {
    if (err) return cb(null, null);
    try {
      const first = json.query && json.query.search && json.query.search[0];
      if (first && first.title) return cb(null, first.title);
    } catch (e) {}
    cb(null, null);
  });
};

const searchSpotifyArtistImages = (name, cb) => {
  let called = false;
  const done = (err, res) => {
    if (called) return;
    called = true;
    cb(err, res);
  };

  const configPath = path.join(__dirname, 'data', 'spotify.json');
  if (!fs.existsSync(configPath)) return done(null, []);

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('[sources] error reading spotify.json', e);
    return done(null, []);
  }

  const { clientId, clientSecret } = config;
  if (!clientId || !clientSecret) return done(null, []);

  // 1. Get Access Token
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const authUrl = 'https://accounts.spotify.com/api/token';
  const fetch = require('node-fetch');

  const parseJsonResponse = async (res, label) => {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch (e) {
      console.warn('[sources] Spotify non-JSON response:', {
        label,
        status: res.status,
        // Keep the log small; most pages include useful hint near the beginning.
        sample: String(text).slice(0, 240)
      });
      return null;
    }
  };

  fetch(authUrl, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: 'grant_type=client_credentials'
  })
  .then(res => parseJsonResponse(res, 'token'))
  .then(authJson => {
    const token = authJson.access_token;
    if (!token) {
      // Make misconfiguration obvious: client credentials should return access_token.
      console.warn('[sources] Spotify token missing:', {
        error: authJson && authJson.error ? authJson.error : 'unknown',
        status: authJson && authJson.status ? authJson.status : undefined
      });
      return done(null, []);
    }

    // 2. Search Artist
    const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=1`;
    return fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
  })
  .then(res => res ? parseJsonResponse(res, 'search') : null)
  .then(searchJson => {
    if (!searchJson || !searchJson.artists || !searchJson.artists.items[0]) return done(null, []);
    const artist = searchJson.artists.items[0];
    const images = (artist.images || []).map(img => ({ url: img.url, source: 'spotify' }));
    done(null, images);
  })
  .catch(err => {
    console.error('[sources] Spotify error:', err);
    done(null, []);
  });
};

const searchLastFmImages = (name, cb) => {
  const configPath = path.join(__dirname, 'data', 'lastfm.json');
  if (!fs.existsSync(configPath)) return cb(null, []);
  
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    return cb(null, []);
  }
  
  const apiKey = config.apiKey;
  if (!apiKey) return cb(null, []);
  
  // Use artist.search to find artist and get images from artist.getinfo
  const searchUrl = `https://ws.audioscrobbler.com/2.0/?method=artist.search&artist=${encodeURIComponent(name)}&api_key=${apiKey}&format=json&limit=5`;
  httpGetJson(searchUrl, (err, json) => {
    if (err) return cb(err, []);
    try {
      const matches = json.results && json.results.artistmatches && json.results.artistmatches.artist ? json.results.artistmatches.artist : [];
      if (matches.length === 0) return cb(null, []);
      
      // Get images from first match using artist.getinfo
      const mbid = matches[0].mbid;
      const getInfoUrl = mbid 
        ? `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&mbid=${mbid}&api_key=${apiKey}&format=json`
        : `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(matches[0].name)}&api_key=${apiKey}&format=json`;
      
      httpGetJson(getInfoUrl, (err2, infoJson) => {
        if (err2) return cb(err2, []);
        const images = [];
        try {
          const artist = infoJson.artist || infoJson;
          // Last.fm provides image URLs in various sizes
          const imageSizes = ['extralarge', 'large', 'medium', 'small'];
          for (const size of imageSizes) {
            const img = artist.image ? (Array.isArray(artist.image) ? artist.image.find(i => i.size === size) : artist.image) : null;
            if (img && img['#text'] && img['#text'].length > 0) {
              images.push({ url: img['#text'], source: 'lastfm' });
            }
          }
        } catch (e) {
          return cb(null, []);
        }
        cb(null, images.slice(0, 5));
      });
    } catch (e) {
      return cb(null, []);
    }
  });
};

const searchCommonsImages = (name, cb) => {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=10&prop=imageinfo&iiprop=url|mime|extmetadata`;
  httpGetJson(url, (err, json) => {
    if (err) return cb(err, []);
    const images = [];
    try {
      const pages = json.query && json.query.pages ? Object.values(json.query.pages) : [];
      const skipKeywords = ['cover', 'album', 'single', 'sleeve', 'artwork', 'front', 'back', 'vinyl', 'cd_'];
      for (const p of pages) {
        if (p && p.imageinfo && p.imageinfo[0] && p.imageinfo[0].url) {
          const urlStr = p.imageinfo[0].url.toLowerCase();
          const metadata = (p.imageinfo[0].extmetadata && p.imageinfo[0].extmetadata.ObjectName && p.imageinfo[0].extmetadata.ObjectName.value) ? p.imageinfo[0].extmetadata.ObjectName.value.toLowerCase() : '';
          
          const isCover = skipKeywords.some(kw => urlStr.includes(kw) || metadata.includes(kw));
          if (!isCover) {
            images.push({ url: p.imageinfo[0].url, source: 'commons' });
          }
        }
      }
    } catch (e) { return cb(null, []); }
    cb(null, images.slice(0, 10)); // return filtered
  });
};

const fetchAndStoreArtistByName = (nameRaw, cb) => {
  const name = (nameRaw || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  console.log('[sources] Starting fetch for artist:', name);
  
  searchMusicBrainzArtist(name, (err, mbArtist) => {
    if (err || !mbArtist) {
      console.log('[sources] MusicBrainz lookup failed for:', name, err);
      return cb(err || new Error('mb_not_found'));
    }

    const mbid = mbArtist.id;
    const disambiguation = mbArtist.disambiguation || '';

    // Parallel fetch for Wiki and Releases
    let wikiData = null;
    let discography = [];

    const onWikiDone = (data) => {
      wikiData = data;
      checkAllDone();
    };

    const onReleasesDone = (releases) => {
      discography = releases;
      checkAllDone();
    };

    let remaining = 2;
    const checkAllDone = () => {
      remaining--;
      if (remaining === 0) finalize();
    };

    // 1. Wikipedia fetch
    searchWikipediaByName(name, (errS, title) => {
      if (title) {
        fetchWikipediaSummary(title, (errW, data) => onWikiDone(data));
      } else {
        onWikiDone(null);
      }
    });

  // 2. Releases fetch
    fetchReleasesForArtist(mbid, (errR, releases) => {
      const disc = [];
      const coverPromises = [];
      // Limit to max 30 releases and only include primary-type 'Album'
      const rels = (releases || []).filter(r => {
        const rg = r['release-group'];
        return rg && rg['primary-type'] === 'Album';
      }).slice(0, 30);
      for (const r of rels) {
        const year = r.date ? (r.date.split('-')[0]) : null;
        const entry = { id: r.id, title: r.title, year: year, cover_url: null };
        disc.push(entry);
        coverPromises.push(new Promise((res) => {
          const rgid = (r['release-group'] && r['release-group'].id) ? r['release-group'].id : null;
          fetchCoverArt(r.id, rgid, (errC, url) => { entry.cover_url = url; res(); });
        }));
      }
      Promise.all(coverPromises).then(() => onReleasesDone(disc));
    });

    const finalize = () => {
      const artistObj = {
        id: mbid,
        name: mbArtist.name,
        disambiguation: disambiguation,
        bio: (wikiData && wikiData.extract) ? wikiData.extract : '',
        wiki_url: (wikiData && wikiData.url) ? wikiData.url : null,
        discography: discography,
        default_image_id: null
      };

      console.log('[sources] Finalizing and upserting artist to DB:', mbid);
      db.upsertArtist(artistObj, (errU) => {
        if (errU) {
          console.error('[sources] upsertArtist failed:', errU);
          return cb(errU);
        }

        // Gather all image sources (dedupe by URL)
        const images = [];
        const seen = new Set();
        
        const isLikelyCover = (url) => {
          if (!url) return false;
          const u = url.toLowerCase();
          const skipKeywords = ['cover', 'album', 'single', 'sleeve', 'artwork', 'front', 'back', 'vinyl', 'cd_', 'digipak', 'booklet', 'insert', 'tray'];
          return skipKeywords.some(kw => u.includes(kw));
        };

        const addImg = (url, src, id) => {
          if (url && !seen.has(url) && images.length < 5) {
            // Spotify image URLs sometimes contain "cover/album" substrings even when the image
            // is a proper artist portrait. Don't over-filter Spotify; still keep the heuristic
            // for Wikipedia/Commons where we observed cover-likes more often.
            if (src !== 'spotify' && isLikelyCover(url)) return false;
            images.push({ id: id, url: url, source: src, thumbnail_url: url });
            seen.add(url);
            return true;
          }
          return false;
        };

        if (wikiData && wikiData.thumbnail) {
          addImg(wikiData.thumbnail, 'wikipedia', `${mbid}-wiki`);
        }

        // Fetch Spotify images (may fail without premium)
        searchSpotifyArtistImages(name, (errS, spotifyImgs) => {
          if (errS) console.warn('[sources] Spotify image fetch warning:', errS);
          for (let i = 0; i < (spotifyImgs || []).length; i++) {
            if (!addImg(spotifyImgs[i].url, 'spotify', `${mbid}-spotify-${i}`)) {
               // do NOT break if one image is cover, just try next
            }
          }

          // Fetch Last.fm images (free API)
          if (images.length < 5) {
            searchLastFmImages(name, (errL, lastfmImgs) => {
              if (errL) console.warn('[sources] Last.fm image fetch warning:', errL);
              for (let i = 0; i < (lastfmImgs || []).length; i++) {
                if (!addImg(lastfmImgs[i].url, 'lastfm', `${mbid}-lastfm-${i}`)) {
                }
              }

              // If still under 5, add from Wikimedia Commons
              if (images.length < 5) {
                searchCommonsImages(name, (errC, commons) => {
                  if (errC) console.warn('[sources] Commons image fetch warning:', errC);
                  for (let i = 0; i < (commons || []).length; i++) {
                    addImg(commons[i].url, 'commons', `${mbid}-comm-${i}`);
                  }
                  onImagesReady(images);
                });
              } else {
                onImagesReady(images);
              }
            });
          } else {
            onImagesReady(images);
          }
        });

        const onImagesReady = (imgs) => {
          console.log('[sources] Adding images bulk, count:', imgs.length);
          db.addImagesBulk(mbid, imgs, (errB) => {
            if (errB) {
              console.error('[sources] addImagesBulk failed:', errB);
              return cb(errB);
            }
            const first = imgs[0];
            if (first) {
              db.setDefaultImage(mbid, first.id, (errD) => {
                if (errD) console.warn('[sources] setDefaultImage failed:', errD);
                cb(null, mbid);
              });
            } else {
              cb(null, mbid);
            }
          });
        };
      });
    };
  });
};

// Fetch additional releases beyond those currently stored for an artist and append them.
const fetchAndAppendMoreReleases = (mbid, cb) => {
  // Get full releases from MusicBrainz (up to 100)
  fetchReleasesForArtist(mbid, (err, releasesFull) => {
    if (err) return cb(err);
    // Load current artist from DB to determine which releases we already have
    db.getArtistById(mbid, (errDb, artistRow) => {
      if (errDb) return cb(errDb);
      const existingIds = new Set((artistRow && artistRow.discography ? artistRow.discography : []).map(r => String(r.id)));
        const toAdd = [];
        for (const r of (releasesFull || [])) {
          // Only consider releases whose release-group primary-type is 'Album'
          try {
            const rg = r['release-group'];
            if (!rg || rg['primary-type'] !== 'Album') continue;
          } catch (e) {
            continue;
          }
          if (!existingIds.has(String(r.id))) {
            const year = r.date ? (r.date.split('-')[0]) : null;
            toAdd.push({ id: r.id, title: r.title, year: year, cover_url: null });
          }
        }

      if (toAdd.length === 0) {
        return cb(null, []);
      }

      // For each new release, fetch cover art then append and persist
      const coverPromises = [];
      for (const entry of toAdd) {
        coverPromises.push(new Promise((res) => {
          // find release-group id by matching in releasesFull
          const rf = releasesFull.find(x => String(x.id) === String(entry.id));
          const rgid = (rf && rf['release-group'] && rf['release-group'].id) ? rf['release-group'].id : null;
          fetchCoverArt(entry.id, rgid, (errC, url) => { entry.cover_url = url; res(); });
        }));
      }

      Promise.all(coverPromises).then(() => {
        // merge with existing discography and dedupe by release id
        const existing = (artistRow && artistRow.discography) ? artistRow.discography : [];
        const map = new Map();
        for (const e of existing) {
          if (e && e.id) map.set(String(e.id), e);
        }
        for (const e of toAdd) {
          if (e && e.id && !map.has(String(e.id))) map.set(String(e.id), e);
        }
        const combined = Array.from(map.values());
        // upsert artist with combined discography
        const artistObj = {
          id: mbid,
          name: (artistRow && artistRow.name) ? artistRow.name : '',
          disambiguation: (artistRow && artistRow.disambiguation) ? artistRow.disambiguation : '',
          bio: (artistRow && artistRow.bio) ? artistRow.bio : '',
          wiki_url: (artistRow && artistRow.wiki_url) ? artistRow.wiki_url : null,
          discography: combined,
          default_image_id: (artistRow && artistRow.default_image_id) ? artistRow.default_image_id : null
        };

        db.upsertArtist(artistObj, (errU) => {
          if (errU) return cb(errU);
          // prepare images: include existing + new releases
          const images = [];
          const seen = new Set();
          // First: add existing images to preserve them
          if (artistRow && artistRow.images) {
            for (const img of artistRow.images) {
              if (img.url) {
                images.push(img);
                seen.add(img.url);
              }
            }
          }
          // Then: add new release covers
          for (const d of toAdd) {
            if (d.cover_url && !seen.has(d.cover_url)) {
              images.push({ id: `${mbid}-rel-${d.id}`, url: d.cover_url, source: 'coverartarchive', thumbnail_url: d.cover_url });
              seen.add(d.cover_url);
            }
          }
          if (images.length === 0) return cb(null, toAdd);
          db.addImagesBulk(mbid, images, (errAdd) => {
            if (errAdd) return cb(errAdd);
            cb(null, toAdd);
          });
        });
      }).catch(e => cb(e));
    });
  });
};

module.exports = {
  fetchAndStoreArtistByName,
  fetchAndAppendMoreReleases,
  // exported for use by handlers that need to check available releases
  fetchReleasesForArtist,
  fetchReleaseById
};
