const https = require('https');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
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

const getHighResLastFmUrl = (url) => {
  if (typeof url !== 'string') return url;
  if (url.includes('lastfm.freetls.fastly.net/i/u/')) {
    // Replace size segment (e.g., 300x300, avatar170s, 770x0) with '_' for original quality
    return url.replace(/\/i\/u\/[^\/]+\//, '/i/u/_/');
  }
  return url;
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

const ensureImagesDir = () => {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
};

const downloadImage = (url, artistMbid, imageIndex) => {
  return new Promise((resolve, reject) => {
    ensureImagesDir();
    
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const filename = `${artistMbid}-artist-${imageIndex}${ext}`;
    const localPath = path.join(IMAGES_DIR, filename);
    
    if (fs.existsSync(localPath)) {
      console.log('[sources] Image already cached:', filename);
      return resolve(localPath);
    }
    
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        const file = fs.createWriteStream(localPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('[sources] Downloaded image:', filename);
          resolve(localPath);
        });
        file.on('error', (err) => {
          fs.unlink(localPath, () => {});
          reject(err);
        });
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
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
  
  for (let s = 0; s < enabledSources.length; s++) {
    const sourceUrl = enabledSources[s].replace('{ARTIST}', encodeURIComponent(name));
    const sourceBase = enabledSources[s].includes('last.fm') ? 'lastfm' : 'web';
    console.log('[sources] Scraping from:', sourceUrl);
    
    (async () => {
      let browser;
      try {
        browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9'
        });
        
        await page.goto(sourceUrl, { waitUntil: 'networkidle0', timeout: 60000 });
        
        try {
          await page.waitForSelector('img[src*="fastly.net"]:not([src*="2a96cbd8"])', { timeout: 10000 });
        } catch (e) {
          console.log('[sources] No images with src, trying data-src...');
          try {
            await page.waitForSelector('img[data-src*="fastly.net"]:not([data-src*="2a96cbd8"])', { timeout: 5000 });
          } catch (e2) {
            console.log('[sources] No images with data-src either');
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
        
        const images = [];
        
        if (sourceBase === 'lastfm') {
          
          const galleryInfo = await page.evaluate(() => {
            const getHighResLastFmUrl = (url) => {
              if (typeof url !== 'string') return url;
              if (url.includes('lastfm.freetls.fastly.net/i/u/')) {
                return url.replace(/\/i\/u\/[^\/]+\//, '/i/u/_/');
              }
              return url;
            };

            const result = {
              pageTitle: document.title,
              allLinks: [],
              images: []
            };
            
            Array.from(document.querySelectorAll('a')).forEach(a => {
              if (a.href.includes('images') || a.href.includes('photo')) {
                result.allLinks.push({
                  href: a.href,
                  text: a.textContent.trim().substring(0, 50),
                  className: a.className
                });
              }
            });
            
            document.querySelectorAll('img').forEach((img) => {
              const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-image');
              if (src && src.includes('fastly.net') && !src.includes('2a96cbd8') && !src.includes('avatar')) {
                result.images.push(getHighResLastFmUrl(src.split('#')[0]));
              }
              if (img.srcset) {
                const parts = img.srcset.split(',').map(s => s.trim().split(' ')[0]);
                parts.forEach(p => {
                  if (p && p.includes('fastly.net') && !p.includes('2a96cbd8') && !p.includes('avatar')) {
                    result.images.push(getHighResLastFmUrl(p.split('#')[0]));
                  }
                });
              }
            });
            
            return result;
          });
          
          const uniqueImages = [...new Set(galleryInfo.images)];
          console.log('[sources] Gallery found', uniqueImages.length, 'direct images');
          
          if (uniqueImages.length > 0) {
            for (let i = 0; i < Math.min(uniqueImages.length, 5); i++) {
              images.push({ url: uniqueImages[i], source: sourceBase, id: `${name}-${sourceBase}-${i}` });
            }
          } else {
            console.log('[sources] No direct images, trying image pages...');
            let imagePageUrls = galleryInfo.allLinks
              .filter(l => l.href.match(/\+images\/[a-f0-9]+$/) || l.href.match(/\/photo\/[a-f0-9]+$/))
              .map(l => l.href)
              .slice(0, 3);
            
            for (let i = 0; i < imagePageUrls.length; i++) {
              const imagePageUrl = imagePageUrls[i];
              console.log('[sources] Scraping image page:', imagePageUrl);
              try {
                await page.goto(imagePageUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const pageImages = await page.evaluate(() => {
                  const getHighResLastFmUrl = (url) => {
                    if (typeof url !== 'string') return url;
                    if (url.includes('lastfm.freetls.fastly.net/i/u/')) {
                      return url.replace(/\/i\/u\/[^\/]+\//, '/i/u/_/');
                    }
                    return url;
                  }
                  const imgs = [];
                  document.querySelectorAll('img').forEach((img) => {
                    const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-image');
                    if (src && src.includes('fastly.net') && !src.includes('2a96cbd8')) {
                      imgs.push(getHighResLastFmUrl(src.split('#')[0]));
                    }
                  });
                  return [...new Set(imgs)];
                });
                
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
            if (src && src.startsWith('http') && !src.includes('placeholder') && !src.includes('2a96cbd8')) {
              images.push({ url: src, source: sourceBase, id: `${name}-${sourceBase}-${i}` });
            }
          }
        }
        
        console.log('[sources] Source', sourceBase, 'found', images.length, 'images');
        allImages.push(...images);
        
      } catch (err) {
        console.log('[sources] Scrape error:', err.message);
      } finally {
        if (browser) await browser.close();
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

const searchLastFmImages = scrapeArtistImages;

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
    searchWikipediaByName(name, (errS, title) => {
      if (title) {
        fetchWikipediaSummary(title, (errW, data) => onWikiDone(data));
      } else {
        onWikiDone(null);
      }
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
      
      const isLikelyCover = (url) => {
        if (!url) return false;
        const u = url.toLowerCase();
        const skipKeywords = ['cover', 'album', 'single', 'sleeve', 'artwork', 'front', 'back', 'vinyl', 'cd_', 'digipak', 'booklet', 'insert', 'tray'];
        return skipKeywords.some(kw => u.includes(kw));
      };

      const addImg = async (urlRaw, src, id) => {
        const url = (src === 'lastfm') ? getHighResLastFmUrl(urlRaw) : urlRaw;
        if (url && !seen.has(url) && images.length < 5) {
          if (src !== 'spotify' && isLikelyCover(url)) return false;
          
          let localPath = url;
          try {
            if (url.startsWith('http')) {
              const imgIndex = images.length;
              setImportStatus(name, { status: `Downloading image ${imgIndex + 1}/5 (${images.length} saved)...`, mbid });
              await new Promise(r => setTimeout(r, 100)); // small delay for visibility
              localPath = await downloadImage(url, mbid, imgIndex);
            }
          } catch (dlErr) {
            console.warn('[sources] Failed to download image, using remote URL:', dlErr.message);
          }
          
          images.push({ id: id, url: localPath, source: src, thumbnail_url: localPath });
          seen.add(url);
          return true;
        }
        return false;
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
        const orderedImgs = [...wikipedia, ...lastfm, ...commons, ...others];
        
        // Select default: prefer wikipedia if no existing default
        let defaultImg = orderedImgs[0];
        if (!existingDefaultImageId && wikipedia.length > 0) {
          defaultImg = wikipedia[0];
        }
        
        db.addImagesBulk(mbid, orderedImgs, (errB) => {
          if (errB) console.error('[sources] addImagesBulk failed:', errB);
          if (defaultImg) {
            db.setDefaultImage(mbid, defaultImg.id, (errD) => {
              if (errD) console.warn('[sources] setDefaultImage failed:', errD);
              setImportStatus(name, { status: 'Done', mbid });
              safeCallback(null, mbid);
            });
          } else {
            setImportStatus(name, { status: 'Done', mbid });
            safeCallback(null, mbid);
          }
        });
      };

      setImportStatus(name, { status: 'Fetching images from Last.fm', mbid });
      searchLastFmImages(name, async (errL, lastfmImgs) => {
        if (errL) console.warn('[sources] Last.fm image fetch warning:', errL);
        const foundLast = (lastfmImgs || []).length;
        for (let i = 0; i < foundLast; i++) {
          await addImg(lastfmImgs[i].url, 'lastfm', `${mbid}-lastfm-${i}`);
        }
        if (images.length > 0) {
          setImportStatus(name, { status: `${images.length} image(s) saved from Last.fm`, mbid });
        }

        if (images.length < 5) {
          setImportStatus(name, { status: 'Fetching images from Commons', mbid });
          searchCommonsImages(name, async (errC, commons) => {
            if (errC) console.warn('[sources] Commons image fetch warning:', errC);
            for (let i = 0; i < (commons || []).length; i++) {
              await addImg(commons[i].url, 'commons', `${mbid}-comm-${i}`);
            }
            setImportStatus(name, { status: `${images.length} image(s) saved total`, mbid });
            await new Promise(r => setTimeout(r, 500));
            onImagesReady(images);
          });
        } else {
          await new Promise(r => setTimeout(r, 500));
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
