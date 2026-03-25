const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');
const sharp = require('sharp');
const db = require('./db');

// Ensure DB initialized
db.init();

const UA = 'HQPWV/0.1 (https://github.com/zaum/hqpwave)';

const isRetryableRequestError = (err) => {
  const message = String((err && err.message) || err || '').toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('eai_again') ||
    message.includes('temporary') ||
    message.includes('http error 429') ||
    message.includes('http error 500') ||
    message.includes('http error 502') ||
    message.includes('http error 503') ||
    message.includes('http error 504')
  );
};

const httpGetJson = (url, cb, redirects = 0, options = {}) => {
  if (redirects > 5) return cb(new Error('too_many_redirects'));
  try {
    const opts = new URL(url);
    const protocol = opts.protocol === 'http:' ? http : https;
    const headers = Object.assign({ 'User-Agent': UA, 'Accept': 'application/json' }, options.headers || {});
    const timeout = options.timeout || 10000;
    let settled = false;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      cb(err, result);
    };
    const req = protocol.request(opts, { method: 'GET', headers, timeout }, (res) => {
      // follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        res.resume();
        return httpGetJson(next, finish, redirects + 1, options);
      }
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        try {
          if (res.statusCode >= 400) {
            finish(new Error(`HTTP error ${res.statusCode}`), null);
            return;
          }
          finish(null, JSON.parse(data));
        } catch (e) { finish(e); }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      finish(new Error('timeout'));
    });
    req.on('error', (e) => finish(e));
    req.end();
  } catch (e) {
    cb(e);
  }
};

const musicbrainzCache = new Map();
const musicbrainzQueue = [];
let musicbrainzProcessing = false;

// Track import progress per artist name (or temporary key)
const importStatus = new Map();
const importInFlight = new Map();
let importRunCounter = 0;
const recentImportResults = new Map();
const RECENT_IMPORT_TTL_MS = 15000;
const DEFAULT_RELEASE_LIMIT = 99;
const MAX_RELEASE_LIMIT = 9999;
const DEFAULT_IMAGE_LIMIT = 5;
const MAX_IMAGE_LIMIT = 99;
const MUSICBRAINZ_RELEASE_PAGE_LIMIT = 100;

const setImportStatus = (key, statusObj) => {
  try {
    importStatus.set(String(key), statusObj);
  } catch (e) {}
};

const getImportStatus = (key) => {
  try {
    return importStatus.get(String(key)) || null;
  } catch (e) { return null; }
};

const sanitizeReleaseLimit = (value) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RELEASE_LIMIT;
  }
  return Math.min(parsed, MAX_RELEASE_LIMIT);
};

const sanitizeImageLimit = (value) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_IMAGE_LIMIT;
  }
  return Math.min(parsed, MAX_IMAGE_LIMIT);
};

const getImportKey = (name, releaseLimit = DEFAULT_RELEASE_LIMIT, imageLimit = DEFAULT_IMAGE_LIMIT) => {
  return `${String(name || '').trim().toLowerCase()}::releases=${sanitizeReleaseLimit(releaseLimit)}::images=${sanitizeImageLimit(imageLimit)}`;
};
const IMPORT_LOG_SEPARATOR = '[sources] ================================================================================';

const isArtistRecordCompleteEnough = (artist) => {
  if (!artist) return false;
  const hasBio = !!(artist.bio && String(artist.bio).trim().length > 40);
  const hasWiki = !!artist.wiki_url;
  const hasDiscography = Array.isArray(artist.discography) && artist.discography.length > 0;
  const artistImageCount = Array.isArray(artist.images)
    ? artist.images.filter((img) => img && img.id && !String(img.id).includes('-rel-')).length
    : 0;
  return hasDiscography && (hasBio || hasWiki) && artistImageCount > 0;
};

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


const fetchReleasesForArtist = (mbid, releaseLimitOrCb, maybeCb) => {
  const cb = (typeof releaseLimitOrCb === 'function') ? releaseLimitOrCb : maybeCb;
  const targetAlbumCount = sanitizeReleaseLimit((typeof releaseLimitOrCb === 'function') ? DEFAULT_RELEASE_LIMIT : releaseLimitOrCb);
  const collectedAlbums = [];

  const fetchPage = (offset) => {
    const q = querystring.stringify({
      artist: mbid,
      fmt: 'json',
      limit: MUSICBRAINZ_RELEASE_PAGE_LIMIT,
      offset: offset,
      inc: 'release-groups'
    });
    const url = `https://musicbrainz.org/ws/2/release?${q}`;
    console.log('[sources] Fetching releases from MusicBrainz:', url);
    musicbrainzGet(url, (err, json) => {
      if (err) {
        console.error('[sources] MusicBrainz releases error:', err);
        return cb(err);
      }

      const pageReleases = Array.isArray(json && json.releases) ? json.releases : [];
      for (const release of pageReleases) {
        const rg = release && release['release-group'];
        if (rg && rg['primary-type'] === 'Album') {
          collectedAlbums.push(release);
          if (collectedAlbums.length >= targetAlbumCount) {
            return cb(null, collectedAlbums.slice(0, targetAlbumCount));
          }
        }
      }

      if (pageReleases.length === MUSICBRAINZ_RELEASE_PAGE_LIMIT && collectedAlbums.length < targetAlbumCount) {
        fetchPage(offset + pageReleases.length);
        return;
      }

      cb(null, collectedAlbums.slice(0, targetAlbumCount));
    }, 10); // Priority 10
  };

  fetchPage(0);
};

const fetchReleaseById = (releaseId, cb) => {
  if (!releaseId) return cb(new Error('missing_release_id'));
  const url = `https://musicbrainz.org/ws/2/release/${encodeURIComponent(releaseId)}?fmt=json`;
  musicbrainzGet(url, cb, 0); // Priority 0 (background)
};

const fetchWikipediaSummary = (title, cb) => {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'));
  // Use the query API to get a longer plaintext extract, fullurl, and the best available image.
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageimages|info&explaintext=1&piprop=original|thumbnail&pithumbsize=1600&inprop=url&titles=${encoded}&redirects=1&formatversion=2`;
  httpGetJsonWithRetry(url, (err, json) => {
    if (err) return cb(null, null);
    try {
      const page = json.query && json.query.pages && json.query.pages[0] ? json.query.pages[0] : null;
      if (!page || page.missing) return cb(null, null);
      const extract = page.extract || '';
      const thumbnail =
        (page.original && page.original.source) ? page.original.source :
        ((page.thumbnail && page.thumbnail.source) ? page.thumbnail.source : null);
      const pageUrl = page.fullurl || (`https://en.wikipedia.org/wiki/${encoded}`);
      cb(null, { extract, thumbnail, url: pageUrl });
    } catch (e) { cb(null, null); }
  }, { timeout: 9000, maxAttempts: 2, retryDelayMs: 400 });
};

const getHighResLastFmUrl = (url) => {
  if (typeof url !== 'string') return url;
  if (url.includes('lastfm.freetls.fastly.net/i/u/')) {
    // Replace size segment (e.g., 300x300, avatar170s, 770x0) with '_' for original quality
    return url.replace(/\/i\/u\/[^\/]+\//, '/i/u/_/');
  }
  return url;
};

const searchWikipediaByName = (name, cb) => {
  const escapedName = String(name || '').replace(/"/g, '\\"').trim();
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`intitle:"${escapedName}"`)}&format=json&srlimit=5`;
  httpGetJsonWithRetry(url, (err, json) => {
    if (err) return cb(null, null);
    try {
      const results = json.query && json.query.search ? json.query.search : [];
      const exact = results.find((item) => item && item.title && item.title.toLowerCase() === escapedName.toLowerCase());
      if (exact && exact.title) return cb(null, exact.title);
      const first = results[0];
      if (first && first.title) return cb(null, first.title);
    } catch (e) {}
    cb(null, null);
  }, { timeout: 9000, maxAttempts: 2, retryDelayMs: 400 });
};

// Spotify image fetch removed per user request.
// Previously the code used Spotify API to fetch artist images. That logic
// was removed to avoid external Spotify dependency and API credentials.

const IMAGES_DIR = path.join(__dirname, 'data', 'images');

const ensureImagesDir = () => {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
};

const httpGetText = (url, cb, redirects = 0) => {
  if (redirects > 5) return cb(new Error('too_many_redirects'));
  try {
    const opts = new URL(url);
    const protocol = opts.protocol === 'http:' ? require('http') : https;
    let settled = false;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      cb(err, result);
    };
    const req = protocol.request(opts, { method: 'GET', headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }, timeout: 5000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        res.resume();
        return httpGetText(next, finish, redirects + 1);
      }
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          finish(new Error(`HTTP error ${res.statusCode}`), null);
          return;
        }
        finish(null, data);
      });
    });
    req.on('timeout', () => {
      req.destroy();
      finish(new Error('timeout'));
    });
    req.on('error', (e) => finish(e));
    req.end();
  } catch (e) {
    cb(e);
  }
};

const httpGetJsonWithRetry = (url, cb, options = {}, attempt = 0) => {
  httpGetJson(url, (err, json) => {
    if (!err) {
      cb(null, json);
      return;
    }
    const maxAttempts = options.maxAttempts || 1;
    if (attempt + 1 >= maxAttempts || !isRetryableRequestError(err)) {
      cb(err, null);
      return;
    }
    const retryDelayMs = options.retryDelayMs || 350;
    setTimeout(() => {
      httpGetJsonWithRetry(url, cb, options, attempt + 1);
    }, retryDelayMs * (attempt + 1));
  }, 0, options);
};

const httpGetTextWithRetry = (url, cb, options = {}, attempt = 0) => {
  httpGetText(url, (err, text) => {
    if (!err) {
      cb(null, text);
      return;
    }
    const maxAttempts = options.maxAttempts || 1;
    if (attempt + 1 >= maxAttempts || !isRetryableRequestError(err)) {
      cb(err, null);
      return;
    }
    const retryDelayMs = options.retryDelayMs || 350;
    setTimeout(() => {
      httpGetTextWithRetry(url, cb, options, attempt + 1);
    }, retryDelayMs * (attempt + 1));
  }, 0);
};

const runWithConcurrency = async (items, limit, worker) => {
  const safeLimit = Math.max(1, Math.min(limit || 1, items.length || 1));
  let currentIndex = 0;
  const runners = Array.from({ length: safeLimit }, async () => {
    while (true) {
      const index = currentIndex++;
      if (index >= items.length) {
        break;
      }
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
};

const normalizeArtistSlug = (value) => String(value || '')
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const encodeLastFmArtistPath = (name) => encodeURIComponent(String(name || '')).replace(/%20/g, '+');

const decodeHtmlEntity = (value) => String(value || '')
  .replace(/&amp;/g, '&')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&quot;|&#34;/g, '"');

const buildLastFmImageUrlFromId = (id) => {
  if (!id) return null;
  return `https://lastfm.freetls.fastly.net/i/u/770x0/${id}.jpg`;
};

const extractLastFmImageToken = (value) => {
  const match = String(value || '').match(/([a-f0-9]{32})/i);
  return match ? match[1].toLowerCase() : null;
};

const shortHash = (value) => crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);

const sanitizeImageKey = (value) => String(value || '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '');

const parseLastFmImageCandidates = (html, artistName) => {
  const artistSlug = normalizeArtistSlug(artistName);
  const candidateUrls = [];
  const candidateIds = [];
  const seenIds = new Set();
  const seenUrls = new Set();

  const addUrl = (value) => {
    const normalized = getHighResLastFmUrl(decodeHtmlEntity(String(value || '').replace(/\\\//g, '/').replace(/#.*/, '')));
    if (!normalized || seenUrls.has(normalized)) return;
    seenUrls.add(normalized);
    candidateUrls.push(normalized);
  };

  const addId = (value) => {
    const match = String(value || '').match(/([a-f0-9]{32})/i);
    if (!match) return;
    const id = match[1].toLowerCase();
    if (seenIds.has(id)) return;
    seenIds.add(id);
    candidateIds.push(id);
  };

  const ogImageMatches = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/ig) || [];
  ogImageMatches.forEach((tag) => {
    const match = tag.match(/content="([^"]+)"/i);
    if (match && match[1] && match[1].includes('lastfm.freetls.fastly.net')) addUrl(match[1]);
  });

  const linkRegex = /href="([^"]*\/music\/[^"]*\/\+images\/([a-f0-9]{32})[^"]*)"/ig;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html))) {
    const href = decodeHtmlEntity(linkMatch[1]);
    const hrefArtistMatch = href.match(/\/music\/([^/]+)\/\+images\//i);
    const hrefArtistSlug = hrefArtistMatch ? normalizeArtistSlug(decodeURIComponent(hrefArtistMatch[1].replace(/\+/g, ' '))) : '';
    if (hrefArtistSlug && hrefArtistSlug === artistSlug) addId(linkMatch[2]);
  }

  const fastlyRegex = /lastfm\.freetls\.fastly\.net\/i\/u\/[^"'<)\s]+/ig;
  let fastlyMatch;
  while ((fastlyMatch = fastlyRegex.exec(html))) {
    const cleaned = decodeHtmlEntity(fastlyMatch[0]).replace(/\\+/g, '').replace(/#.*/, '');
    const idMatch = cleaned.match(/\/([a-f0-9]{32})(?:\.jpg)?$/i);
    if (idMatch) addId(idMatch[1]);
  }

  for (const id of candidateIds) addUrl(buildLastFmImageUrlFromId(id));
  return candidateUrls.slice(0, MAX_IMAGE_LIMIT);
};

const downloadImage = (url, imageKey) => {
  return new Promise((resolve, reject) => {
    ensureImagesDir();
    
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const safeKey = sanitizeImageKey(imageKey) || `img-${shortHash(url)}`;
    const filename = `${safeKey}${ext}`;
    const localPath = path.join(IMAGES_DIR, filename);
    
    if (fs.existsSync(localPath)) {
      console.log('[sources] Image already cached:', filename);
      return resolve({ path: localPath, width: null, height: null });
    }
    
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', async () => {
          let tempPath = null;
          try {
            const buffer = Buffer.concat(chunks);
            tempPath = `${localPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
            fs.writeFileSync(tempPath, buffer);
            
            const metadata = await sharp(tempPath).metadata();
            
            if (metadata.width > 800 || metadata.height > 800) {
              await sharp(tempPath)
                .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toFile(localPath);
              try { fs.unlinkSync(tempPath); } catch (e) {}
              console.log('[sources] Downloaded & resized:', filename, `(${metadata.width}x${metadata.height} -> 800px)`);
            } else {
              fs.renameSync(tempPath, localPath);
              console.log('[sources] Downloaded:', filename, `(${metadata.width}x${metadata.height})`);
            }
            
            resolve({ path: localPath, width: metadata.width, height: metadata.height });
          } catch (err) {
            try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
            reject(err);
          }
        });
        res.on('error', reject);
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
};

const searchLastFmImages = (name, cb) => {
  const artistPath = encodeLastFmArtistPath(name);
  const galleryUrl = `https://www.last.fm/music/${artistPath}/+images`;
  let settled = false;
  const finish = (err, result) => {
    if (settled) {
      console.warn('[sources] Ignoring duplicate Last.fm callback for artist:', name);
      return;
    }
    settled = true;
    cb(err, result);
  };
  httpGetTextWithRetry(galleryUrl, (err, html) => {
    if (err || !html) {
      console.warn('[sources] Last.fm HTML fetch error:', err ? err.message : 'empty_response');
      return finish(null, []);
    }
    try {
      const urls = parseLastFmImageCandidates(html, name);
      const images = urls.map((url, i) => ({
        url,
        source: 'lastfm',
        id: `lastfm-${extractLastFmImageToken(url) || shortHash(`${name}:${url}:${i}`)}`
      }));
      console.log('[sources] Last.fm HTML parser found', images.length, 'images');
      finish(null, images);
    } catch (parseErr) {
      console.warn('[sources] Last.fm HTML parse error:', parseErr.message);
      finish(null, []);
    }
  }, { maxAttempts: 3, retryDelayMs: 500 });
};

const searchCommonsImages = (name, cb) => {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=50&prop=imageinfo&iiprop=url|mime|extmetadata`;
  httpGetJson(url, (err, json) => {
    if (err) {
      console.warn('[sources] Commons fetch error:', err.message);
      return cb(null, []);
    }
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
            images.push({ url: p.imageinfo[0].url, source: 'commons', id: `comm-${shortHash(p.imageinfo[0].url)}` });
          }
        }
      }
    } catch (e) { return cb(null, []); }
    cb(null, images.slice(0, MAX_IMAGE_LIMIT)); // return filtered
  });
};

const fetchAndStoreArtistByName = (nameRaw, optionsOrCb, maybeCb) => {
  const options = (typeof optionsOrCb === 'function' || !optionsOrCb) ? {} : optionsOrCb;
  const cb = (typeof optionsOrCb === 'function') ? optionsOrCb : maybeCb;
  const name = (nameRaw || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const releaseLimit = sanitizeReleaseLimit(options.releaseLimit);
  const imageLimit = sanitizeImageLimit(options.imageLimit);
  const importKey = getImportKey(name, releaseLimit, imageLimit);
  if (importInFlight.has(importKey)) {
    console.log('[sources] Joining in-flight import for artist:', name);
    importInFlight.get(importKey).push(cb);
    return;
  }
  const recent = recentImportResults.get(importKey);
  if (recent && (Date.now() - recent.finishedAt) < RECENT_IMPORT_TTL_MS) {
    db.getArtistById(recent.mbid, (recentErr, recentArtist) => {
      if (!recentErr && isArtistRecordCompleteEnough(recentArtist)) {
        console.log('[sources] Reusing recent complete import for artist:', name, '->', recent.mbid);
        cb(null, recent.mbid);
        return;
      }
      if (recentErr) {
        console.warn('[sources] Recent import verification warning:', recentErr.message);
      }
      recentImportResults.delete(importKey);
      fetchAndStoreArtistByName(name, { releaseLimit, imageLimit }, cb);
    });
    return;
  }
  const runId = ++importRunCounter;
  importInFlight.set(importKey, [cb]);

  let finished = false;
  const finishImport = (err, result) => {
    if (finished) return;
    finished = true;
    const callbacks = importInFlight.get(importKey) || [];
    importInFlight.delete(importKey);
    if (!err && result) {
      recentImportResults.set(importKey, { mbid: result, finishedAt: Date.now() });
    } else {
      recentImportResults.delete(importKey);
    }
    console.log(IMPORT_LOG_SEPARATOR);
    if (err) {
      console.log(`[sources] IMPORT #${runId} FAILED for "${name}":`, err.message || String(err));
    } else {
      console.log(`[sources] IMPORT #${runId} FINISHED for "${name}" -> ${result}`);
    }
    console.log(IMPORT_LOG_SEPARATOR);
    for (const fn of callbacks) {
      try { fn(err, result); } catch (e) {}
    }
  };

  console.log(IMPORT_LOG_SEPARATOR);
  console.log(`[sources] IMPORT #${runId} START for "${name}" (releaseLimit=${releaseLimit}, imageLimit=${imageLimit})`);
  console.log(IMPORT_LOG_SEPARATOR);
  console.log('[sources] Starting fetch for artist:', name);
  // initialize import status for this name
  setImportStatus(name, { status: 'Starting import' });
  
  searchMusicBrainzArtist(name, (err, mbArtist) => {
    if (err || !mbArtist) {
      console.log('[sources] MusicBrainz lookup failed for:', name, err);
      setImportStatus(name, { status: 'MusicBrainz lookup failed', error: err ? String(err) : 'not_found' });
      return finishImport(err || new Error('mb_not_found'));
    }
    setImportStatus(name, { status: 'Found MusicBrainz artist', mbid: mbArtist.id });

    const mbid = mbArtist.id;
    const disambiguation = mbArtist.disambiguation || '';

    // Parallel fetch for Wiki and Releases
    let wikiData = null;
    let discography = [];
    let wikiFinished = false;
    let releasesFinished = false;

    const onWikiDone = (data) => {
      if (wikiFinished) return;
      wikiFinished = true;
      wikiData = data;
      console.log('[sources] Wikipedia result:', {
        artist: name,
        hasData: !!data,
        hasUrl: !!(data && data.url),
        hasExtract: !!(data && data.extract),
        hasThumbnail: !!(data && data.thumbnail)
      });
      checkAllDone();
    };

    const onReleasesDone = (releases) => {
      if (releasesFinished) return;
      releasesFinished = true;
      discography = releases;
      checkAllDone();
    };

    let remaining = 2;
    let finalizeStarted = false;
    const checkAllDone = () => {
      remaining--;
      if (remaining === 0 && !finalizeStarted) {
        finalizeStarted = true;
        finalize().catch((err) => {
          console.error('[sources] finalize error:', err);
          finishImport(err);
        });
      }
    };

    // 1. Wikipedia fetch
    console.log('[sources] Fetching Wikipedia data for:', mbArtist.name || name);
    setImportStatus(name, { status: 'Fetching Wikipedia data', mbid });
    fetchWikipediaSummary(mbArtist.name || name, (errExact, exactData) => {
      if (exactData && (exactData.thumbnail || exactData.extract || exactData.url)) {
        return onWikiDone(exactData);
      }
      searchWikipediaByName(name, (errS, title) => {
        if (title) {
          fetchWikipediaSummary(title, (errW, data) => onWikiDone(data || exactData || null));
        } else {
          onWikiDone(exactData || null);
        }
      });
    });

  // 2. Releases fetch
    setImportStatus(name, { status: 'Fetching releases from MusicBrainz', mbid });
    fetchReleasesForArtist(mbid, releaseLimit, (errR, releases) => {
      const disc = [];
      const rels = releases || [];
      for (const r of rels) {
        const year = r.date ? (r.date.split('-')[0]) : null;
        const rgid = (r['release-group'] && r['release-group'].id) ? r['release-group'].id : null;
        disc.push({
          id: r.id,
          title: r.title,
          year: year,
          release_group_id: rgid,
          cover_url: `https://coverartarchive.org/release/${encodeURIComponent(r.id)}/front-250`,
          cover_fallback_url: rgid ? `https://coverartarchive.org/release-group/${encodeURIComponent(rgid)}/front-250` : null
        });
      }
      onReleasesDone(disc);
    });

    const finalize = async () => {
      const existingArtist = await new Promise((res) => db.getArtistById(mbid, (e, r) => res(r)));
      const existingDefaultImageId = (existingArtist && existingArtist.default_image_id) ? existingArtist.default_image_id : null;

      const images = [];
      const seen = new Set();
      const isLikelyCover = (url) => {
        if (!url) return false;
        const u = url.toLowerCase();
        const skipKeywords = ['cover', 'album', 'single', 'sleeve', 'artwork', 'front', 'back', 'vinyl', 'cd_', 'digipak', 'booklet', 'insert', 'tray'];
        return skipKeywords.some(kw => u.includes(kw));
      };

      const addImg = async (urlRaw, src, id) => {
        const originalUrl = urlRaw;
        const highResUrl = (src === 'lastfm') ? getHighResLastFmUrl(urlRaw) : urlRaw;

        if (!highResUrl || seen.has(highResUrl) || images.length >= imageLimit) return null;
        if (src === 'lastfm' && isLikelyCover(highResUrl)) return null;

        seen.add(highResUrl);
        let localPath = highResUrl;
        const isLastFm = src === 'lastfm';
        const localImageKey = id || `${mbid}-${src}-${shortHash(highResUrl)}`;

        try {
          if (highResUrl.startsWith('http')) {
            setImportStatus(name, { status: `Downloading image ${Math.min(images.length + 1, imageLimit)}/${imageLimit}...`, mbid });

            if (isLastFm && highResUrl !== originalUrl) {
              try {
                const result = await downloadImage(highResUrl, localImageKey);
                localPath = result.path;
                // If the "original" Last.fm asset is tiny, fall back to the displayed variant.
                if (result.width && result.width < 400) {
                  console.log('[sources] High-res too small (' + result.width + 'px), trying thumbnail...');
                  localPath = await downloadImage(originalUrl, localImageKey);
                  if (typeof localPath === 'object') localPath = localPath.path;
                }
              } catch (highResErr) {
                console.log('[sources] High-res failed, trying thumbnail...');
                localPath = await downloadImage(originalUrl, localImageKey);
                if (typeof localPath === 'object') localPath = localPath.path;
              }
            } else {
              localPath = await downloadImage(highResUrl, localImageKey);
              if (typeof localPath === 'object') localPath = localPath.path;
            }
          }
        } catch (dlErr) {
          console.warn('[sources] Failed to download image:', dlErr.message);
          return null;
        }

        if (typeof localPath === 'object') localPath = localPath.path;
        return { id: id, url: localPath, source: src, thumbnail_url: localPath };
      };

      const appendImagesFromSource = async (items, src, buildId, concurrencyLimit = 1) => {
        const remainingSlots = Math.max(0, imageLimit - images.length);
        if (remainingSlots === 0) return;
        const selected = (items || []).slice(0, remainingSlots);
        if (selected.length === 0) return;
        const downloaded = new Array(selected.length).fill(null);
        await runWithConcurrency(selected, Math.min(concurrencyLimit, selected.length), async (item, index) => {
          const url = item && item.url ? item.url : item;
          const id = buildId(item, index);
          downloaded[index] = await addImg(url, src, id);
        });
        for (const img of downloaded) {
          if (img && images.length < imageLimit) {
            images.push(img);
          }
        }
      };

      if (wikiData && wikiData.thumbnail) {
        const wikiImg = await addImg(wikiData.thumbnail, 'wikipedia', `${mbid}-wiki`);
        if (wikiImg) images.push(wikiImg);
      }

      const safeCallback = (err, result) => {
        finishImport(err, result);
      };

      let imagesReady = false;
      const onImagesReady = (imgs) => {
        if (imagesReady) {
          console.warn('[sources] onImagesReady called more than once for artist:', name);
          return;
        }
        imagesReady = true;
        console.log('[sources] Adding images bulk, count:', imgs.length);
        setImportStatus(name, { status: `Storing ${imgs.length} images`, mbid });
        
        // Reorder: put wikipedia first, then lastfm, then commons
        const wikipedia = imgs.filter(i => i.source && (i.source === 'wikipedia' || i.source === 'wiki' || i.source.includes('wiki')));
        const lastfm = imgs.filter(i => i.source === 'lastfm');
        const commons = imgs.filter(i => i.source === 'commons');
        const others = imgs.filter(i => !['wikipedia', 'wiki', 'lastfm', 'commons'].some(s => i.source && i.source.includes(s)));
        const orderedImgs = [...wikipedia, ...lastfm, ...commons, ...others].slice(0, imageLimit);
        
        // Select default: preserve an existing valid choice, otherwise prefer wikipedia.
        let defaultImg = null;
        if (existingDefaultImageId) {
          defaultImg = orderedImgs.find((img) => String(img.id) === String(existingDefaultImageId)) || null;
        }
        if (!defaultImg && wikipedia.length > 0) {
          defaultImg = wikipedia[0];
        }
        if (!defaultImg) {
          defaultImg = orderedImgs[0] || null;
        }

        const finalDefaultImageId = defaultImg ? defaultImg.id : existingDefaultImageId;
        const artistObj = {
          id: mbid,
          name: mbArtist.name,
          disambiguation: disambiguation,
          // Persist MusicBrainz life-span so frontend can display reliable years
          life_span: (mbArtist && mbArtist['life-span']) ? mbArtist['life-span'] : null,
          bio: (wikiData && wikiData.extract) ? wikiData.extract : '',
          wiki_url: (wikiData && wikiData.url) ? wikiData.url : null,
          discography: discography,
          default_image_id: finalDefaultImageId || null
        };

        console.log('[sources] Finalizing and upserting artist to DB:', mbid, 'preserving default_image_id:', existingDefaultImageId);
        db.upsertArtist(artistObj, (errU) => {
          if (errU) {
            console.error('[sources] upsertArtist failed:', errU);
            safeCallback(errU);
            return;
          }

          db.addImagesBulk(mbid, orderedImgs, (errB) => {
          if (errB) console.error('[sources] addImagesBulk failed:', errB);
          const imgCount = orderedImgs.length;
          const srcCount = { wikipedia: 0, lastfm: 0, commons: 0 };
          orderedImgs.forEach(img => {
            if (img.source === 'wikipedia' || img.source === 'wiki') srcCount.wikipedia++;
            else if (img.source === 'lastfm') srcCount.lastfm++;
            else if (img.source === 'commons') srcCount.commons++;
          });
            setImportStatus(name, { status: 'Done', mbid });
            console.log(`[sources] DONE: "${name}" - ${imgCount} images (Wikipedia: ${srcCount.wikipedia}, Last.fm: ${srcCount.lastfm}, Commons: ${srcCount.commons})`);
            safeCallback(null, mbid);
          });
        });
      };

      console.log('[sources] Fetching artist images from Last.fm for:', name);
      setImportStatus(name, { status: 'Fetching images from Last.fm', mbid });
      searchLastFmImages(name, async (errL, lastfmImgs) => {
        if (errL) console.warn('[sources] Last.fm image fetch warning:', errL);
        const foundLast = (lastfmImgs || []).length;
        
        if (foundLast > 0) {
          await appendImagesFromSource(
            lastfmImgs,
            'lastfm',
            (item, i) => `${mbid}-${item.id || `lastfm-${i}`}`,
            3
          );
        }
        
        if (images.length > 0) {
          setImportStatus(name, { status: `${images.length} image(s) saved from Last.fm`, mbid });
        }

        if (images.length < imageLimit) {
          setImportStatus(name, { status: 'Fetching images from Commons', mbid });
          searchCommonsImages(name, async (errC, commons) => {
            if (errC) console.warn('[sources] Commons image fetch warning:', errC);
            
            if ((commons || []).length > 0) {
              await appendImagesFromSource(
                commons,
                'commons',
                (item, i) => `${mbid}-${item.id || `comm-${i}`}`,
                2
              );
            }
            
            setImportStatus(name, { status: `${images.length} image(s) saved total`, mbid });
            onImagesReady(images);
          });
        } else {
          onImagesReady(images);
        }
      });
    };
  });
};

module.exports = {
  fetchAndStoreArtistByName,
  // exported for use by handlers that need to check available releases
  fetchReleasesForArtist,
  fetchReleaseById,
  getImportStatus,
  setImportStatus
};
