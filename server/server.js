/**
 * Server entrypoint.
 * Plain js.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const bodyParser = require("body-parser");
const archiver = require('archiver');
const app = express();
const os = require('os');

const log = require('./log');
const db = require('./db');
const packageJson = require('./../package.json');
const proxy = require('./proxy');
const fetch = require('node-fetch');
const meta = require('./meta');
const commandHandler = require('./server-command-handler');
const metaHandler = require('./server-meta-handler');
const playlistHandler = require('./server-playlist-handler');
const playlists = require('./playlists');
const artistHandler = require('./artist-handler');
const sources = require('./sources');
const { safeJson, safeStatusJson, safeSend, safeSendFile } = require('./response-util');

const APP_FILENAME = `hqpwv`;
const WEBPAGE_DIR = path.join( __dirname, './../www' );
const DEFAULT_PORT = 8000;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

let port;
let server;
let hqpIp;
const DEFAULT_ARTIST_RELEASE_LIMIT = 99;
const MAX_ARTIST_RELEASE_LIMIT = 9999;
const DEFAULT_ARTIST_IMAGE_LIMIT = 5;
const MAX_ARTIST_IMAGE_LIMIT = 99;

let artistBatchImportState = {
  status: 'idle',
  total: 0,
  checked: 0,
  remaining: 0,
  imported: 0,
  skipped: 0,
  failed: 0,
  currentArtist: null,
  startedAt: null,
  finishedAt: null,
  releaseLimit: DEFAULT_ARTIST_RELEASE_LIMIT,
  imageLimit: DEFAULT_ARTIST_IMAGE_LIMIT,
  lastError: null,
  shouldStop: false
};

const sanitizeArtistReleaseLimit = (value) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ARTIST_RELEASE_LIMIT;
  }
  return Math.min(parsed, MAX_ARTIST_RELEASE_LIMIT);
};

const sanitizeArtistImageLimit = (value) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ARTIST_IMAGE_LIMIT;
  }
  return Math.min(parsed, MAX_ARTIST_IMAGE_LIMIT);
};

const sanitizeArtistNames = (artistNames) => {
  if (!Array.isArray(artistNames)) {
    return [];
  }
  const result = [];
  const seen = new Set();
  for (const rawName of artistNames) {
    const name = String(rawName || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
};

const getArtistByNameAsync = (name) => new Promise((resolve, reject) => {
  db.getArtistByName(name, (err, artist) => {
    if (err) {
      reject(err);
      return;
    }
    resolve(artist || null);
  });
});

const importArtistByNameAsync = (name, options) => new Promise((resolve, reject) => {
  sources.fetchAndStoreArtistByName(name, options, (err, mbid) => {
    if (err) {
      reject(err);
      return;
    }
    resolve(mbid);
  });
});

const isArtistBatchImportRunning = () => artistBatchImportState.status === 'running';

const updateArtistBatchImportState = (patch) => {
  artistBatchImportState = Object.assign({}, artistBatchImportState, patch);
};

const startArtistBatchImport = (artistNames, options = {}) => {
  const sanitizedNames = sanitizeArtistNames(artistNames);
  const releaseLimit = sanitizeArtistReleaseLimit(options.releaseLimit);
  const imageLimit = sanitizeArtistImageLimit(options.imageLimit);

  updateArtistBatchImportState({
    status: sanitizedNames.length > 0 ? 'running' : 'done',
    total: sanitizedNames.length,
    checked: 0,
    remaining: sanitizedNames.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    currentArtist: null,
    startedAt: Date.now(),
    finishedAt: sanitizedNames.length > 0 ? null : Date.now(),
    releaseLimit,
    imageLimit,
    lastError: null
  });

  if (sanitizedNames.length === 0) {
    return;
  }

  setImmediate(async () => {
    for (const artistName of sanitizedNames) {
      if (artistBatchImportState.shouldStop) {
        console.log(`[server] artistBatchImport stopped by user at artist ${artistBatchImportState.checked + 1} of ${artistBatchImportState.total}`);
        updateArtistBatchImportState({
          status: 'stopped',
          remaining: 0,
          currentArtist: null,
          finishedAt: Date.now()
        });
        return;
      }

      updateArtistBatchImportState({ currentArtist: artistName });

      try {
        const existingArtist = await getArtistByNameAsync(artistName);
        if (existingArtist) {
          updateArtistBatchImportState({
            checked: artistBatchImportState.checked + 1,
            skipped: artistBatchImportState.skipped + 1,
            remaining: Math.max(0, artistBatchImportState.total - (artistBatchImportState.checked + 1))
          });
          continue;
        }
      } catch (lookupErr) {
        console.warn(`[server] artistBatchImport lookup warning for "${artistName}":`, lookupErr.message);
      }

      try {
        await importArtistByNameAsync(artistName, { releaseLimit, imageLimit });
        updateArtistBatchImportState({
          checked: artistBatchImportState.checked + 1,
          imported: artistBatchImportState.imported + 1,
          remaining: Math.max(0, artistBatchImportState.total - (artistBatchImportState.checked + 1))
        });
      } catch (importErr) {
        console.error(`[server] artistBatchImport item error for "${artistName}":`, importErr);
        updateArtistBatchImportState({
          checked: artistBatchImportState.checked + 1,
          failed: artistBatchImportState.failed + 1,
          remaining: Math.max(0, artistBatchImportState.total - (artistBatchImportState.checked + 1)),
          lastError: importErr.message || String(importErr)
        });
      }
    }

    updateArtistBatchImportState({
      status: 'done',
      remaining: 0,
      currentArtist: null,
      finishedAt: Date.now()
    });
  });
};

const getServerIp = () => {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net && net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch (e) {
    // fallback
  }
  return '127.0.0.1';
};

const normalizeRequestedPath = (inputPath) => {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  let pathToOpen = inputPath;
  try {
    pathToOpen = decodeURIComponent(pathToOpen);
  } catch (e) {
    // keep raw if it was not URI-encoded
  }
  pathToOpen = pathToOpen.trim();
  pathToOpen = pathToOpen.replace(/^file:\/+/i, '');

  if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(pathToOpen)) {
    pathToOpen = pathToOpen.slice(1);
  }
  if (process.platform === 'win32' && /^[a-zA-Z]\|/.test(pathToOpen)) {
    pathToOpen = pathToOpen.replace(/^([a-zA-Z])\|/, '$1:');
  }
  return path.normalize(pathToOpen);
};

const isImageFilename = (filename) => {
  const ext = path.extname(filename || '').toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
};

const isHiddenName = (name) => {
  return !!name && name.startsWith('.');
};

const hasHiddenPathSegment = (inputPath) => {
  if (!inputPath) {
    return false;
  }
  const normalizedPath = inputPath.replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);
  return segments.some((segment) => segment.startsWith('.'));
};

const collectAlbumImagesRecursive = (folderPath, rootPath) => {
  let images = [];
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    if (isHiddenName(entry.name)) {
      continue;
    }

    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      images = images.concat(collectAlbumImagesRecursive(fullPath, rootPath));
      continue;
    }
    if (!entry.isFile() || !isImageFilename(entry.name)) {
      continue;
    }
    const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
    images.push({ relPath, fullPath });
  }

  return images;
};

// ---

if (__dirname.includes('/lee/')) {
  log.setLevel(log.LEVEL_VERBOSE);
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(WEBPAGE_DIR));

/**
 * 'commands'
 * Get proxied to HQPlayer.
 */
app.get('/endpoints/command', (request, response) => {
  commandHandler.go(request, response);
});

// Simple proxy endpoint to fetch arbitrary HTML for same-origin usage (used for AllMusic lookups)
// Note: only allow whitelisted hosts to avoid open proxy abuse.
app.get('/endpoints/proxyFetch', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    safeStatusJson(res, 400, { error: 'bad_param' });
    return;
  }
  try {
    const allowedHosts = new Set(['www.allmusic.com', 'allmusic.com']);
    const u = new URL(url);
    if (!allowedHosts.has(u.hostname)) {
      safeStatusJson(res, 403, { error: 'forbidden_host' });
      return;
    }
    // perform server-side fetch
    const fetch = require('node-fetch');
    const r = await fetch(url, { redirect: 'follow' });
    const text = await r.text();
    res.set('Content-Type', 'text/html; charset=utf-8');
    safeSend(res, text);
  } catch (e) {
    safeStatusJson(res, 500, { error: 'error' });
  }
});

/**
 * 'native'
 */
app.get('/endpoints/native', (request, response) => {

  if (request.query.info !== undefined) {
    response.send({
      hqplayer_ip_address: hqpIp,
      server_ip_address: getServerIp(),
      hqpwv_version: packageJson.version
    });
    return;
  }

  if (request.query.openFolder !== undefined) {
    const userAgent = (request.get('user-agent') || '').toLowerCase();
    const isMobileUa = /android|iphone|ipad|ipod|mobile|windows phone|blackberry/.test(userAgent);
    if (isMobileUa) {
      safeStatusJson(response, 403, { error: 'desktop_only' });
      return;
    }

    const inputPath = request.query.path;
    if (!inputPath || typeof inputPath !== 'string') {
      safeStatusJson(response, 400, { error: 'bad_param_data' });
      return;
    }

    let pathToOpen = normalizeRequestedPath(inputPath);

    try {
        if (!fs.existsSync(pathToOpen)) {
        safeStatusJson(response, 404, { error: 'path_not_found' });
        return;
      }

      const stat = fs.statSync(pathToOpen);
      if (stat.isFile()) {
        pathToOpen = path.dirname(pathToOpen);
      }

      let command;
      let args;
      if (process.platform === 'win32') {
        command = 'explorer';
        args = [pathToOpen];
      } else if (process.platform === 'darwin') {
        command = 'open';
        args = [pathToOpen];
      } else {
        command = 'xdg-open';
        args = [pathToOpen];
      }

      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      safeJson(response, { ok: true });
      return;
    } catch (error) {
      safeStatusJson(response, 500, { error: 'open_failed' });
      return;
    }
  }

  if (request.query.albumImages !== undefined) {
    const inputPath = request.query.path;
    if (!inputPath || typeof inputPath !== 'string') {
      safeStatusJson(response, 400, { error: 'bad_param_data', images: [] });
      return;
    }

    try {
      let folderPath = normalizeRequestedPath(inputPath);
        if (!fs.existsSync(folderPath)) {
        safeStatusJson(response, 404, { error: 'path_not_found', images: [] });
        return;
      }

      const stat = fs.statSync(folderPath);
      if (stat.isFile()) {
        folderPath = path.dirname(folderPath);
      }

      const images = collectAlbumImagesRecursive(folderPath, folderPath)
        .sort((a, b) => a.relPath.localeCompare(b.relPath, undefined, { numeric: true, sensitivity: 'base' }))
        .map((item) => `/endpoints/native?albumImage=1&path=${encodeURIComponent(item.fullPath)}`);

      safeJson(response, { images });
      return;
    } catch (error) {
      safeStatusJson(response, 500, { error: 'read_failed', images: [] });
      return;
    }
  }

  if (request.query.albumImage !== undefined) {
    const inputPath = request.query.path;
    if (!inputPath || typeof inputPath !== 'string') {
      safeStatusJson(response, 400, { error: 'bad_param_data' });
      return;
    }

    try {
      const imagePath = normalizeRequestedPath(inputPath);
      if (hasHiddenPathSegment(imagePath)) {
        safeStatusJson(response, 400, { error: 'bad_param_data' });
        return;
      }
      if (!fs.existsSync(imagePath)) {
        safeStatusJson(response, 404, { error: 'path_not_found' });
        return;
      }

      const stat = fs.statSync(imagePath);
      if (!stat.isFile() || !isImageFilename(imagePath)) {
        safeStatusJson(response, 400, { error: 'bad_param_data' });
        return;
      }

      // Use safeSendFile for file responses
      safeSendFile(response, path.resolve(imagePath));
      return;
    } catch (error) {
      safeStatusJson(response, 500, { error: 'read_failed' });
      return;
    }
  }

  // No recognized param
  safeStatusJson(response, 400, { error: 'bad_param_data' });
});

/**
 * 'meta'
 */
app.get('/endpoints/meta', (request, response) => {
  metaHandler.doGet(request, response);
});

app.post('/endpoints/meta', (request, response) => {
  metaHandler.doPost(request, response);
});

/**
 * 'artist' endpoints (artist metadata + image serving)
 */
app.get('/endpoints/artist', (request, response) => {
  artistHandler.doGet(request, response);
});

app.post('/endpoints/artist', (request, response) => {
  artistHandler.doPost(request, response);
});

/** Import artist metadata from external sources (MusicBrainz/Wikipedia/CoverArt) */
app.post('/endpoints/artistImport', (request, response) => {
  const name = request.query['name'] || (request.body && request.body.name);
  const waitForCompletion = request.query['wait'] !== undefined || (request.body && request.body.wait);
  const source = request.query['source'] || (request.body && request.body.source) || 'unknown';
  const releaseLimit = sanitizeArtistReleaseLimit(request.query['releaseLimit'] || (request.body && request.body.releaseLimit));
  const imageLimit = sanitizeArtistImageLimit(request.query['imageLimit'] || (request.body && request.body.imageLimit));
  if (!name) {
    safeStatusJson(response, 400, { error: 'missing_required_param' });
    return;
  }
  try {
    console.log(`[server] artistImport request: name="${name}" source="${source}" wait=${waitForCompletion ? '1' : '0'} releaseLimit=${releaseLimit} imageLimit=${imageLimit}`);
    if (sources.setImportStatus) {
      sources.setImportStatus(name, { status: 'Starting import' });
    }

    if (waitForCompletion) {
      sources.fetchAndStoreArtistByName(name, { releaseLimit, imageLimit }, (err, mbid) => {
        if (err) {
          console.error('[server] artistImport sync error:', err);
          safeStatusJson(response, 500, { error: 'import_failed', message: err.message || String(err) });
          return;
        }
        safeJson(response, { result: true, id: mbid });
      });
      return;
    }

    // Start import in background and return immediately. Client will poll status.
    setImmediate(() => {
      sources.fetchAndStoreArtistByName(name, { releaseLimit, imageLimit }, (err, mbid) => {
        if (err) console.error('[server] artistImport background error:', err);
      });
    });
    safeJson(response, { result: true, started: true });
  } catch (e) {
    console.error('[server] artistImport start error:', e);
    safeStatusJson(response, 500, { error: 'start_failed' });
  }
});

app.post('/endpoints/artistBatchImport', (request, response) => {
  const artistNames = sanitizeArtistNames((request.body && request.body.artistNames) || []);
  const releaseLimit = sanitizeArtistReleaseLimit(request.query['releaseLimit'] || (request.body && request.body.releaseLimit));
  const imageLimit = sanitizeArtistImageLimit(request.query['imageLimit'] || (request.body && request.body.imageLimit));

  if (artistNames.length === 0) {
    safeStatusJson(response, 400, { error: 'missing_artist_names' });
    return;
  }

  if (isArtistBatchImportRunning()) {
    safeJson(response, { result: true, already_running: true, status: artistBatchImportState });
    return;
  }

  console.log(`[server] artistBatchImport request: total=${artistNames.length} releaseLimit=${releaseLimit} imageLimit=${imageLimit}`);
  startArtistBatchImport(artistNames, { releaseLimit, imageLimit });
  safeJson(response, { result: true, started: true, status: artistBatchImportState });
});

app.get('/endpoints/artistBatchImportStatus', (request, response) => {
  safeJson(response, { status: artistBatchImportState });
});

app.post('/endpoints/artistBatchImportStop', (request, response) => {
  if (artistBatchImportState.status !== 'running') {
    safeJson(response, { result: true, was_running: false });
    return;
  }
  updateArtistBatchImportState({ shouldStop: true });
  safeJson(response, { result: true, was_running: true });
});

// Return import progress for a given artist name
app.get('/endpoints/artistImportStatus', (request, response) => {
  const name = request.query['name'];
  if (!name) return safeStatusJson(response, 400, { error: 'missing_required_param' });
  try {
    const status = sources.getImportStatus(name);
    safeJson(response, { status: status });
  } catch (e) {
    safeStatusJson(response, 500, { error: 'status_error' });
  }
});

app.get('/endpoints/artistImage', (request, response) => {
  artistHandler.doImage(request, response);
});

app.get('/endpoints/cover', async (request, response) => {
  const { hash, size, v } = request.query;
  if (!hash) {
    return response.status(400).send('Missing hash parameter');
  }
  const maxSize = parseInt(size, 10) || 400;
  const hqplayerIp = hqpIp;
  if (!hqplayerIp) {
    return response.status(503).send('HQPlayer not connected');
  }
  const coverUrl = `http://${hqplayerIp}:8088/cover/${hash}?v=${v || ''}`;
  try {
    const imageBuffer = await fetch(coverUrl).then(res => {
      if (!res.ok) throw new Error(`HQPlayer cover fetch failed: ${res.status}`);
      return res.arrayBuffer();
    });
    const sharp = require('sharp');
    const resized = await sharp(Buffer.from(imageBuffer))
      .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
      .toFormat('jpeg', { quality: 85 })
      .toBuffer();
    response.set('Content-Type', 'image/jpeg');
    response.set('Cache-Control', 'public, max-age=31536000');
    response.send(resized);
  } catch (err) {
    console.error('[cover endpoint] Error:', err.message);
    response.status(500).send('Failed to fetch/resize cover');
  }
});

app.get('/endpoints/artistDbStats', (req, res) => {
  const dbPath = path.join(__dirname, 'data', 'artists.db');
  const imagesPath = path.join(__dirname, 'data', 'images');
  let dbSize = 0;
  let imagesSize = 0;
  let imageCount = 0;
  
  if (fs.existsSync(dbPath)) {
    try {
      const stats = fs.statSync(dbPath);
      dbSize = stats.size;
    } catch (e) {}
  }
  
  if (fs.existsSync(imagesPath)) {
    try {
      const files = fs.readdirSync(imagesPath);
      imageCount = files.length;
      for (const file of files) {
        try {
          const filePath = path.join(imagesPath, file);
          const fileStats = fs.statSync(filePath);
          imagesSize += fileStats.size;
        } catch (e) {}
      }
    } catch (e) {}
  }
  
  const totalSize = dbSize + imagesSize;
  res.json({
    dbSize: dbSize,
    imagesSize: imagesSize,
    totalSize: totalSize,
    dbSizeFormatted: formatBytes(dbSize),
    imagesSizeFormatted: formatBytes(imagesSize),
    totalSizeFormatted: formatBytes(totalSize),
    imageCount: imageCount
  });
});

app.post('/endpoints/artistDbClear', (req, res) => {
  const dbPath = path.join(__dirname, 'data', 'artists.db');
  const imagesPath = path.join(__dirname, 'data', 'images');
  let errors = [];

  if (isArtistBatchImportRunning()) {
    res.status(409).json({ success: false, error: 'Artist metadata download is running in the background. Wait for it to finish before clearing the cache.' });
    return;
  }
  
  try {
    db.close();
    for (const candidatePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
      try {
        if (fs.existsSync(candidatePath)) {
          fs.unlinkSync(candidatePath);
        }
      } catch (e) {
        errors.push(`DB file ${path.basename(candidatePath)}: ${e.message}`);
      }
    }
    db.init();
  } catch (e) {
    errors.push('DB: ' + e.message);
  }

  let imagesCleared = false;
  try {
    if (fs.existsSync(imagesPath)) {
      const deleteFolderRecursive = (dirPath) => {
        if (fs.existsSync(dirPath)) {
          fs.readdirSync(dirPath).forEach((file) => {
            const curPath = path.join(dirPath, file);
            try {
              if (fs.lstatSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
              } else {
                fs.unlinkSync(curPath);
              }
            } catch (e) {
              // Skip locked files
            }
          });
          try {
            fs.rmdirSync(dirPath);
          } catch (e) {
            // Skip if directory can't be removed
          }
        }
      };
      deleteFolderRecursive(imagesPath);
    }
    fs.mkdirSync(imagesPath, { recursive: true });
    imagesCleared = true;
  } catch (e) {
    if (!fs.existsSync(imagesPath)) {
      try {
        fs.mkdirSync(imagesPath, { recursive: true });
        imagesCleared = true;
      } catch (mkdirErr) {
        // Non-fatal, continue
      }
    }
  }
  
  if (errors.length > 0) {
    res.json({ success: true, warning: errors.join(', ') + (imagesCleared ? '' : '. Images folder may not be fully cleared.') });
  } else {
    artistBatchImportState = {
      status: 'idle',
      total: 0,
      checked: 0,
      remaining: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      currentArtist: null,
      startedAt: null,
      finishedAt: null,
      releaseLimit: DEFAULT_ARTIST_RELEASE_LIMIT,
      imageLimit: DEFAULT_ARTIST_IMAGE_LIMIT,
      lastError: null,
      shouldStop: false
    };
    res.json({ success: true });
  }
});

app.get('/endpoints/artistDbDownload', (req, res) => {
  const dataDir = path.join(__dirname, 'data');
  const dbPath = path.join(dataDir, 'artists.db');
  const imagesPath = path.join(dataDir, 'images');
  
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename=artist-metadata.zip');
  
  archive.on('error', (err) => {
    res.status(500).send(err.message);
  });
  
  archive.pipe(res);
  
  if (fs.existsSync(dbPath)) {
    archive.file(dbPath, { name: 'artists.db' });
  }
  
  if (fs.existsSync(imagesPath)) {
    archive.directory(imagesPath, 'images');
  }
  
  archive.finalize();
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}


/**
 * 'playlist'
 */
app.get('/endpoints/playlist', (request, response) => {
  playlistHandler.doGet(request, response);
});

app.post('/endpoints/playlist', (request, response) => {
  playlistHandler.doPost(request, response);
});

app.get('/endpoints/imageSources', (req, res) => {
  const configPath = path.join(__dirname, 'data', 'imageSources.json');
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      enabled: true,
      sources: ['https://www.last.fm/music/{ARTIST}/+images/*']
    };
    return res.json(defaultConfig);
  }
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: 'read_error' });
  }
});

app.post('/endpoints/imageSources', (req, res) => {
  const { enabled, sources } = req.body;
  if (enabled === undefined || !Array.isArray(sources)) {
    return res.status(400).json({ error: 'missing_params' });
  }
  const configPath = path.join(__dirname, 'data', 'imageSources.json');
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  try {
    fs.writeFileSync(configPath, JSON.stringify({ enabled, sources }, null, 2), 'utf8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'write_error' });
  }
});

// ---

const onProxyReady = (ip) => {
  hqpIp = ip;
  // Start server
  server = app.listen(port, onSuccess).on('error', onError);

  // Init meta
  let isSuccess = meta.init();
  if (!isSuccess) {
    log.x('warning meta init failed, hqpwv metadata disabled')
  } else {
    log.x('metadata ready');
  }

  // Init custom playlists
  isSuccess = playlists.init();
  if (!isSuccess ) {
    log.x('warning custom playlists init failed, will be disabled')
  } else {
    log.x('custom playlists ready');
  }
};

// ---

const onError = (e) => {
  if (e.code == 'EADDRINUSE') {
    log.x(`ERROR: Port ${port} is in use.`);
    log.x(`Try using a different port:`);
    log.x(`     ${APP_FILENAME} -port [PORTNUMBER]\n`);
    showPromptAndExit();
  } else {
    log.e(`server caught error: ${e.code}`);
  }
};

const onSuccess = () => {
  log.x(`webserver is ready on port ${port}`);
  const ipAddress = getServerIp();
  const urlText = ipAddress
      ? `http://${ipAddress}:${port}`
      : `the IP address of this machine on port ${port}`; // yek
  log.x(`\n----------------------------------------------------`);
  log.x(`READY.`);
  log.x(`Now browse to ${urlText}`);
  log.x(`from a device on your local network.`);
  log.x(`Please keep this process running.`);
  log.x(`----------------------------------------------------`);
};

/**
 * Expects something like `port 8000`, `-port 8000`, `--port 8000`, or simply `8000`
 */
getArgPort = () => {
  const value = getArgValue('port');
  const intValue = parseInt(value);
  return (!isNaN(intValue) && intValue > 0) ? intValue : DEFAULT_PORT;
};

/**
 * Returns the argument that follows the specified argument.
 * @param key should not have leading dashes
 */
getArgValue = (key) => {
  for (let i = 2; i < process.argv.length - 1; i++) {
    const arg = process.argv[i];
    if (arg == key || arg == ('-' + key) || arg == ('--' + key)) {
      const value = process.argv[i + 1];
      return value;
    }
  }
  return null;
};

isArgHelp = () => {
  const arg1 = process.argv[2];
  if (!arg1) {
    return false;
  }
  return (arg1.startsWith('help') || arg1.startsWith('-help') || arg1.startsWith('--help'));
};



printHelp = () => {
  log.x('Optional arguments:');
  log.x('--port [portnumber]');
  log.x('    Port to run the webserver on (default is ' + DEFAULT_PORT + ')');
  log.x('--hqpip [ip_address]');
  log.x('    IP address of the machine running HQPlayer.');
  log.x('    Only necessary if running multiple instances');
  log.x('    of HQPlayer on the network.');
};

const showPromptAndExit = () => {
  log.x('\nPress any key to exit');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', process.exit.bind(process, 1))
};

// Save meta json before exiting
const gracefulShutdown = (signal) => {
  if (meta.getIsDirty()) {
    meta.saveFile();
  }
  log.x(`done (${signal})`);
  process.exit();
};
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('beforeExit', () => {
  if (meta.getIsDirty()) {
    meta.saveFile();
  }
});

// ---

log.x(`\n----------------------------------------------------`);
log.x('HQPWV Server', packageJson.version);
log.x('Project page: ' + packageJson.homepage);
if (isArgHelp()) {
  log.x(`----------------------------------------------------\n`);
  printHelp();
  return;
} else {
  log.x('Use --help for available options.');
  log.x(`----------------------------------------------------\n`);
}

port = getArgPort();
proxy.start(onProxyReady);
