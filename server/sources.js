const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const sharp = require('sharp');
const db = require('./db');
const puppeteer = require('puppeteer');

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

// Track import progress per artist name (or temporary key)
const importStatus = new Map();

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
  // Use the query API to get a longer plaintext extract, fullurl, and the best available image.
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageimages|info&explaintext=1&piprop=original|thumbnail&pithumbsize=1600&inprop=url&titles=${encoded}&formatversion=2`;
  httpGetJson(url, (err, json) => {
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
  });
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
  httpGetJson(url, (err, json) => {
    if (err) return cb(null, null);
    try {
      const results = json.query && json.query.search ? json.query.search : [];
      const exact = results.find((item) => item && item.title && item.title.toLowerCase() === escapedName.toLowerCase());
      if (exact && exact.title) return cb(null, exact.title);
      const first = results[0];
      if (first && first.title) return cb(null, first.title);
    } catch (e) {}
    cb(null, null);
  });
};

// Spotify image fetch removed per user request.
// Previously the code used Spotify API to fetch artist images. That logic
// was removed to avoid external Spotify dependency and API credentials.

const getImageSourcesConfig = () => {
  const configPath = path.join(__dirname, 'data', 'imageSources.json');
  const defaultConfig = {
    enabled: true,
    sources: ['https://www.last.fm/music/{ARTIST}/+images/*']
  };
  
  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }
  
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    return defaultConfig;
  }
};

const IMAGES_DIR = path.join(__dirname, 'data', 'images');
const PUPPETEER_PROFILE_DIR = path.join(__dirname, 'data', 'puppeteer-profile');

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
    const req = protocol.request(opts, { method: 'GET', headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }, timeout: 5000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        res.resume();
        return httpGetText(next, cb, redirects + 1);
      }
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          cb(new Error(`HTTP error ${res.statusCode}`), null);
          return;
        }
        cb(null, data);
      });
    });
    req.on('timeout', () => { req.destroy(); cb(new Error('timeout')); });
    req.on('error', (e) => cb(e));
    req.end();
  } catch (e) {
    cb(e);
  }
};

const ensurePuppeteerProfileDir = () => {
  if (!fs.existsSync(PUPPETEER_PROFILE_DIR)) {
    fs.mkdirSync(PUPPETEER_PROFILE_DIR, { recursive: true });
  }
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
  return candidateUrls.slice(0, 5);
};

const downloadImage = (url, artistMbid, imageIndex) => {
  return new Promise((resolve, reject) => {
    ensureImagesDir();
    
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const filename = `${artistMbid}-artist-${imageIndex}${ext}`;
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
          try {
            const buffer = Buffer.concat(chunks);
            const tempPath = localPath + '.tmp';
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
            try { if (fs.existsSync(localPath + '.tmp')) fs.unlinkSync(localPath + '.tmp'); } catch (e) {}
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

const scrapeArtistImages = (name, cb) => {
  const config = getImageSourcesConfig();
  
  if (!config.enabled) {
    console.log('[sources] Image scraping disabled');
    return cb(null, []);
  }
  
  const enabledSources = config.sources.filter(s => s.endsWith('*')).map(s => s.slice(0, -1));
  
  if (enabledSources.length === 0) {
    console.log('[sources] No enabled image sources');
    return cb(null, []);
  }
  
  console.log('[sources] Scraping images for:', name, 'from', enabledSources.length, 'sources');
  
  const allImages = [];
  let sourcesProcessed = 0;
  const artistSlug = normalizeArtistSlug(name);
  
  for (let s = 0; s < enabledSources.length; s++) {
    const sourceUrl = enabledSources[s].replace('{ARTIST}', encodeURIComponent(name));
    const sourceBase = enabledSources[s].includes('last.fm') ? 'lastfm' : 'web';
    console.log('[sources] Scraping from:', sourceUrl);
    
    (async () => {
      let browser;
      try {
        ensurePuppeteerProfileDir();
        browser = await puppeteer.launch({
          headless: true,
          userDataDir: path.join(PUPPETEER_PROFILE_DIR, sourceBase),
          timeout: 15000,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9'
        });
        
        await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        
        try {
          await page.waitForSelector('a[href*="+images/"], img[src*="fastly.net"], img[data-src*="fastly.net"]', { timeout: 3500 });
        } catch (e) {
          console.log('[sources] Gallery selectors not found quickly, continuing with current DOM');
        }
        
        const images = [];
        
        if (sourceBase === 'lastfm') {
          
          const galleryInfo = await page.evaluate((expectedArtistSlug) => {
            const getHighResLastFmUrl = (url) => {
              if (typeof url !== 'string') return url;
              if (url.includes('lastfm.freetls.fastly.net/i/u/')) {
                return url.replace(/\/i\/u\/[^\/]+\//, '/i/u/_/');
              }
              return url;
            };
            const slugify = (value) => String(value || '')
              .toLowerCase()
              .replace(/&/g, 'and')
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');
            const normalizeUrl = (value) => {
              try {
                return new URL(value, window.location.href);
              } catch (e) {
                return null;
              }
            };
            const extractArtistSlug = (value) => {
              const parsed = normalizeUrl(value);
              if (!parsed) return '';
              const parts = parsed.pathname.split('/').filter(Boolean);
              const musicIndex = parts.findIndex((part) => part === 'music');
              if (musicIndex === -1 || !parts[musicIndex + 1]) return '';
              return slugify(decodeURIComponent(parts[musicIndex + 1]));
            };
            const isGalleryLink = (value) => {
              const parsed = normalizeUrl(value);
              if (!parsed) return false;
              return extractArtistSlug(parsed.href) === expectedArtistSlug && /\/\+images\/[a-z0-9]+$/i.test(parsed.pathname);
            };

            const result = {
              pageTitle: document.title,
              imagePageUrls: [],
              images: []
            };
            
            Array.from(document.querySelectorAll('a')).forEach(a => {
              if (isGalleryLink(a.href)) {
                result.imagePageUrls.push(new URL(a.href, window.location.href).href);
              }
            });
            
            Array.from(document.querySelectorAll('a[href*="+images/"]')).forEach((anchor) => {
              if (!isGalleryLink(anchor.href)) return;
              anchor.querySelectorAll('img').forEach((img) => {
                const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-image');
                if (!src || !src.includes('fastly.net')) return;
                if (src.includes('/avatar') || src.includes('/34s') || src.includes('/64s') || src.includes('/170s/') || src.includes('2a96cbd8')) return;
                const srcsetParts = String(img.srcset || '').split(',').map((s) => s.trim().split(' ')[0]).filter(Boolean);
                const candidates = srcsetParts.length ? srcsetParts : [src];
                candidates.forEach((candidate) => {
                  if (!candidate.includes('fastly.net')) return;
                  if (candidate.includes('2a96cbd8') || candidate.includes('/avatar')) return;
                  result.images.push(getHighResLastFmUrl(candidate.split('#')[0]));
                });
                result.images.push(getHighResLastFmUrl(src.split('#')[0]));
              });
            });
            
            result.imagePageUrls = [...new Set(result.imagePageUrls)].slice(0, 2);
            result.images = [...new Set(result.images)];
            return result;
          }, artistSlug);
          
          const uniqueImages = galleryInfo.images.filter((url) => {
            const lower = String(url || '').toLowerCase();
            return lower && !lower.includes('/avatar') && !lower.includes('2a96cbd8');
          });
          console.log('[sources] Gallery found', uniqueImages.length, 'direct images');
          
          if (uniqueImages.length > 0) {
            for (let i = 0; i < Math.min(uniqueImages.length, 5); i++) {
              images.push({ url: uniqueImages[i], source: sourceBase, id: `${name}-${sourceBase}-${i}` });
            }
          } else {
            console.log('[sources] No direct images, trying image pages...');
            const imagePageUrls = galleryInfo.imagePageUrls.slice(0, 2);
            
            for (let i = 0; i < imagePageUrls.length; i++) {
              const imagePageUrl = imagePageUrls[i];
              console.log('[sources] Scraping image page:', imagePageUrl);
              try {
                await page.goto(imagePageUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
                
                const pageImages = await page.evaluate((expectedArtistSlug) => {
                  const getHighResLastFmUrl = (url) => {
                    if (typeof url !== 'string') return url;
                    if (url.includes('lastfm.freetls.fastly.net/i/u/')) {
                      return url.replace(/\/i\/u\/[^\/]+\//, '/i/u/_/');
                    }
                    return url;
                  };
                  const slugify = (value) => String(value || '')
                    .toLowerCase()
                    .replace(/&/g, 'and')
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
                  const parts = window.location.pathname.split('/').filter(Boolean);
                  const musicIndex = parts.findIndex((part) => part === 'music');
                  const currentArtistSlug = musicIndex !== -1 ? slugify(decodeURIComponent(parts[musicIndex + 1] || '')) : '';
                  if (currentArtistSlug !== expectedArtistSlug) return [];
                  const imgs = [];
                  const meta = document.querySelector('meta[property="og:image"]');
                  if (meta && meta.content && meta.content.includes('fastly.net')) {
                    imgs.push(getHighResLastFmUrl(meta.content.split('#')[0]));
                  }
                  document.querySelectorAll('img').forEach((img) => {
                    const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-image');
                    if (src && src.includes('fastly.net') && !src.includes('2a96cbd8') && !src.includes('avatar') && !src.includes('/34s') && !src.includes('/64s') && !src.includes('/170s/')) {
                      imgs.push(getHighResLastFmUrl(src.split('#')[0]));
                    }
                  });
                  return [...new Set(imgs)];
                }, artistSlug);
                
                if (pageImages.length > 0) {
                  images.push({ url: pageImages[0], source: sourceBase, id: `${name}-${sourceBase}-${i}` });
                }
              } catch (imgErr) {
                console.log('[sources] Image page error:', imgErr.message);
              }
            }
          }
        } else {
          const imgElements = await page.$$('img');
          for (let i = 0; i < imgElements.length; i++) {
            const src = await imgElements[i].evaluate(el => {
              return el.src || el.getAttribute('data-src') || ((el.getAttribute('srcset') || '').split(' ')[0]);
            });
            // Skip similar artist images, avatars, and small thumbnails
            if (src && src.startsWith('http') && !src.includes('placeholder') && !src.includes('2a96cbd8') && !src.includes('/avatar') && !src.includes('/34s') && !src.includes('/64s')) {
              images.push({ url: src, source: sourceBase, id: `${name}-${sourceBase}-${i}` });
            }
          }
        }
        
        console.log('[sources] Source', sourceBase, 'found', images.length, 'images');
        allImages.push(...images);
        
      } catch (err) {
        console.log('[sources] Scrape error:', err.message);
      } finally {
        if (browser) {
          try {
            await browser.close();
          } catch (closeErr) {
            console.warn('[sources] Browser close warning:', closeErr.message);
          }
        }
        sourcesProcessed++;
        if (sourcesProcessed === enabledSources.length) {
          console.log('[sources] Final images:', allImages.length);
          cb(null, allImages.slice(0, 5));
        }
      }
    })();
  }
  
  if (enabledSources.length === 0) {
    cb(null, []);
  }
};

const searchLastFmImages = (name, cb) => {
  const artistPath = encodeLastFmArtistPath(name);
  const galleryUrl = `https://www.last.fm/music/${artistPath}/+images`;
  httpGetText(galleryUrl, (err, html) => {
    if (err || !html) {
      console.warn('[sources] Last.fm HTML fetch error:', err ? err.message : 'empty_response');
      return cb(null, []);
    }
    try {
      const urls = parseLastFmImageCandidates(html, name);
      const images = urls.map((url, i) => ({ url, source: 'lastfm', id: `${name}-lastfm-${i}` }));
      console.log('[sources] Last.fm HTML parser found', images.length, 'images');
      cb(null, images);
    } catch (parseErr) {
      console.warn('[sources] Last.fm HTML parse error:', parseErr.message);
      cb(null, []);
    }
  });
};

const searchCommonsImages = (name, cb) => {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=10&prop=imageinfo&iiprop=url|mime|extmetadata`;
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
  // initialize import status for this name
  setImportStatus(name, { status: 'Starting import' });
  
  searchMusicBrainzArtist(name, (err, mbArtist) => {
    if (err || !mbArtist) {
      console.log('[sources] MusicBrainz lookup failed for:', name, err);
      setImportStatus(name, { status: 'MusicBrainz lookup failed', error: err ? String(err) : 'not_found' });
      return cb(err || new Error('mb_not_found'));
    }
    setImportStatus(name, { status: 'Found MusicBrainz artist', mbid: mbArtist.id });

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
    fetchWikipediaSummary(mbArtist.name || name, (errExact, exactData) => {
      if (exactData && exactData.thumbnail) {
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

    const finalize = async () => {
      const existingArtist = await new Promise((res) => db.getArtistById(mbid, (e, r) => res(r)));
      const existingDefaultImageId = (existingArtist && existingArtist.default_image_id) ? existingArtist.default_image_id : null;
      
      const artistObj = {
        id: mbid,
        name: mbArtist.name,
        disambiguation: disambiguation,
        bio: (wikiData && wikiData.extract) ? wikiData.extract : '',
        wiki_url: (wikiData && wikiData.url) ? wikiData.url : null,
        discography: discography,
        default_image_id: existingDefaultImageId
      };

      console.log('[sources] Finalizing and upserting artist to DB:', mbid, 'preserving default_image_id:', existingDefaultImageId);
      await new Promise((res, rej) => db.upsertArtist(artistObj, (errU) => {
        if (errU) { console.error('[sources] upsertArtist failed:', errU); return rej(errU); }
        res();
      }));

      const images = [];
      const seen = new Set();
      let nextImageIndex = 0;
      
      const isLikelyCover = (url) => {
        if (!url) return false;
        const u = url.toLowerCase();
        const skipKeywords = ['cover', 'album', 'single', 'sleeve', 'artwork', 'front', 'back', 'vinyl', 'cd_', 'digipak', 'booklet', 'insert', 'tray'];
        return skipKeywords.some(kw => u.includes(kw));
      };

      const addImg = async (urlRaw, src, id) => {
        const originalUrl = urlRaw;
        const highResUrl = (src === 'lastfm') ? getHighResLastFmUrl(urlRaw) : urlRaw;

        if (!highResUrl || seen.has(highResUrl) || images.length >= 5) return false;
        if (src === 'lastfm' && isLikelyCover(highResUrl)) return false;

        seen.add(highResUrl);
        let localPath = highResUrl;
        const isLastFm = src === 'lastfm';
        const imgIndex = nextImageIndex++;

        try {
          if (highResUrl.startsWith('http')) {
            setImportStatus(name, { status: `Downloading image ${Math.min(images.length + 1, 5)}/5...`, mbid });

            if (isLastFm && highResUrl !== originalUrl) {
              try {
                const result = await downloadImage(highResUrl, mbid, imgIndex);
                localPath = result.path;
                // If the "original" Last.fm asset is tiny, fall back to the displayed variant.
                if (result.width && result.width < 400) {
                  console.log('[sources] High-res too small (' + result.width + 'px), trying thumbnail...');
                  localPath = await downloadImage(originalUrl, mbid, imgIndex);
                  if (typeof localPath === 'object') localPath = localPath.path;
                }
              } catch (highResErr) {
                console.log('[sources] High-res failed, trying thumbnail...');
                localPath = await downloadImage(originalUrl, mbid, imgIndex);
                if (typeof localPath === 'object') localPath = localPath.path;
              }
            } else {
              localPath = await downloadImage(highResUrl, mbid, imgIndex);
              if (typeof localPath === 'object') localPath = localPath.path;
            }
          }
        } catch (dlErr) {
          console.warn('[sources] Failed to download image:', dlErr.message);
          return false;
        }

        if (typeof localPath === 'object') localPath = localPath.path;
        images.push({ id: id, url: localPath, source: src, thumbnail_url: localPath });
        return true;
      };

      if (wikiData && wikiData.thumbnail) {
        await addImg(wikiData.thumbnail, 'wikipedia', `${mbid}-wiki`);
      }

      const safeCallback = (err, result) => {
        cb(err, result);
      };

      const onImagesReady = (imgs) => {
        console.log('[sources] Adding images bulk, count:', imgs.length);
        setImportStatus(name, { status: `Storing ${imgs.length} images`, mbid });
        
        // Reorder: put wikipedia first, then lastfm, then commons
        const wikipedia = imgs.filter(i => i.source && (i.source === 'wikipedia' || i.source === 'wiki' || i.source.includes('wiki')));
        const lastfm = imgs.filter(i => i.source === 'lastfm');
        const commons = imgs.filter(i => i.source === 'commons');
        const others = imgs.filter(i => !['wikipedia', 'wiki', 'lastfm', 'commons'].some(s => i.source && i.source.includes(s)));
        const orderedImgs = [...wikipedia, ...lastfm, ...commons, ...others].slice(0, 5);
        
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
        
        db.addImagesBulk(mbid, orderedImgs, (errB) => {
          if (errB) console.error('[sources] addImagesBulk failed:', errB);
          const imgCount = orderedImgs.length;
          const srcCount = { wikipedia: 0, lastfm: 0, commons: 0 };
          orderedImgs.forEach(img => {
            if (img.source === 'wikipedia' || img.source === 'wiki') srcCount.wikipedia++;
            else if (img.source === 'lastfm') srcCount.lastfm++;
            else if (img.source === 'commons') srcCount.commons++;
          });
          if (defaultImg) {
            db.setDefaultImage(mbid, defaultImg.id, (errD) => {
              if (errD) console.warn('[sources] setDefaultImage failed:', errD);
              setImportStatus(name, { status: 'Done', mbid });
              console.log(`[sources] DONE: "${name}" - ${imgCount} images (Wikipedia: ${srcCount.wikipedia}, Last.fm: ${srcCount.lastfm}, Commons: ${srcCount.commons})`);
              safeCallback(null, mbid);
            });
          } else {
            setImportStatus(name, { status: 'Done', mbid });
            console.log(`[sources] DONE: "${name}" - ${imgCount} images (Wikipedia: ${srcCount.wikipedia}, Last.fm: ${srcCount.lastfm}, Commons: ${srcCount.commons})`);
            safeCallback(null, mbid);
          }
        });
      };

      setImportStatus(name, { status: 'Fetching images from Last.fm', mbid });
      searchLastFmImages(name, async (errL, lastfmImgs) => {
        if (errL) console.warn('[sources] Last.fm image fetch warning:', errL);
        const foundLast = (lastfmImgs || []).length;
        
        if (foundLast > 0) {
          for (let i = 0; i < lastfmImgs.length && images.length < 5; i++) {
            await addImg(lastfmImgs[i].url, 'lastfm', `${mbid}-lastfm-${i}`);
          }
        }
        
        if (images.length > 0) {
          setImportStatus(name, { status: `${images.length} image(s) saved from Last.fm`, mbid });
        }

        if (images.length < 5) {
          setImportStatus(name, { status: 'Fetching images from Commons', mbid });
          searchCommonsImages(name, async (errC, commons) => {
            if (errC) console.warn('[sources] Commons image fetch warning:', errC);
            
            if ((commons || []).length > 0) {
              for (let i = 0; i < commons.length && images.length < 5; i++) {
                await addImg(commons[i].url, 'commons', `${mbid}-comm-${i}`);
              }
            }
            
            setImportStatus(name, { status: `${images.length} image(s) saved total`, mbid });
            onImagesReady(images);
          });
        } else {
          onImagesReady(images);
        }
      });
    };
    
    finalize().catch((err) => { console.error('[sources] finalize error:', err); cb(err); });
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
  , getImportStatus
};
