const fs = require('fs');
const path = require('path');
const log = require('./log');

let cache = {};
let dirty = false;
let saveTimeout = null;
const SAVE_DELAY = 5000;
const CACHE_FILE = path.resolve(__dirname, '..', 'hqpwv-label-cache.json');

let musicMetadata = null;

async function ensureMusicMetadata() {
  if (!musicMetadata) {
    try {
      musicMetadata = require('music-metadata');
    } catch (e) {
      log.w('music-metadata not available, labels disabled');
      return false;
    }
  }
  return true;
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      cache = JSON.parse(raw);
      let fixed = false;
      for (const key of Object.keys(cache)) {
        const val = cache[key];
        if (val !== null && val !== undefined && typeof val !== 'string') {
          if (Array.isArray(val)) {
            cache[key] = val.filter(Boolean).join(', ');
          } else {
            cache[key] = String(val);
          }
          fixed = true;
        }
      }
      if (fixed) {
        saveCache();
      }
      log.i('loaded label cache: ' + Object.keys(cache).length + ' entries');
    }
  } catch (e) {
    log.w('could not load label cache: ' + e.message);
    cache = {};
  }
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    dirty = false;
  } catch (e) {
    log.w('could not save label cache: ' + e.message);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (dirty) saveCache();
  }, SAVE_DELAY);
}

function getCachedLabel(albumHash) {
  return cache[albumHash] !== undefined ? cache[albumHash] : null;
}

function normalizeFilePath(rawPath) {
  let p = rawPath || '';
  try { p = decodeURIComponent(p); } catch (e) {}
  p = p.trim().replace(/^file:\/+/i, '');
  if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
  if (process.platform === 'win32' && /^[a-zA-Z]\|/.test(p)) p = p.replace(/^([a-zA-Z])\|/, '$1:');
  return path.normalize(p);
}

function getLabelFromCommon(common) {
  if (common.publisher) return common.publisher;
  if (common.label) {
    if (Array.isArray(common.label)) {
      return common.label.filter(Boolean).join(', ');
    }
    return common.label;
  }
  if (common.organization) return common.organization;
  return null;
}

async function extractLabelFromFile(filePath) {
  try {
    const meta = await musicMetadata.parseFile(filePath, { duration: false, skipCovers: true });
    return getLabelFromCommon(meta.common) || null;
  } catch (e) {
    return null;
  }
}

async function ensureLabel(albumHash, albumPath, trackNames) {
  const cached = getCachedLabel(albumHash);
  if (cached !== null) return cached;

  const available = await ensureMusicMetadata();
  if (!available) return null;

  const resolvedPath = normalizeFilePath(albumPath);
  for (const trackName of trackNames) {
    const trackPath = path.join(resolvedPath, trackName);
    if (fs.existsSync(trackPath)) {
      const label = await extractLabelFromFile(trackPath);
      if (label) {
        cache[albumHash] = label;
        scheduleSave();
        return label;
      }
    }
  }

  cache[albumHash] = '';
  scheduleSave();
  return null;
}

function injectLabels(json) {
  const dirs = json?.['LibraryGet']?.['LibraryDirectory'];
  if (!dirs) return;

  const albums = Array.isArray(dirs) ? dirs : [dirs];
  let hasUncached = false;

  for (const album of albums) {
    if (!album || !album['@_hash']) continue;
    if (!album['LibraryFile']) continue;

    let cached = getCachedLabel(album['@_hash']);
    if (cached !== null && cached !== '') {
      if (Array.isArray(cached)) {
        cached = cached.filter(Boolean).join(', ');
      }
      if (typeof cached === 'string') {
        album['@_label'] = cached;
      }
    } else if (cached === null) {
      hasUncached = true;
    }
  }

  if (hasUncached) {
    json['@_labelsExtracting'] = true;
  }
}

async function backgroundEnsureLabels(json) {
  const dirs = json?.['LibraryGet']?.['LibraryDirectory'];
  if (!dirs) return;

  const albums = Array.isArray(dirs) ? dirs : [dirs];
  const available = await ensureMusicMetadata();
  if (!available) return;

  for (const album of albums) {
    if (!album || !album['@_hash']) continue;
    if (!album['LibraryFile']) continue;
    if (cache[album['@_hash']] !== undefined) continue;

    const tracks = Array.isArray(album['LibraryFile']) ? album['LibraryFile'] : [album['LibraryFile']];
    const trackNames = tracks.map(t => t['@_name']).filter(Boolean);
    const albumPath = album['@_path'];
    if (!albumPath || !trackNames.length) continue;

    try {
      await ensureLabel(album['@_hash'], albumPath, trackNames);
    } catch (e) {
      cache[album['@_hash']] = '';
      scheduleSave();
    }
  }
}

loadCache();

module.exports = {
  injectLabels,
  backgroundEnsureLabels,
  getCachedLabel,
  getLabelFromCommon,
  extractLabelFromFile
};
