const fs = require('fs');
const path = require('path');
const log = require('./log');
const { normalizeFilePath } = require('./file-util');

let cache = {};
let dirty = false;
let saveTimeout = null;
const SAVE_DELAY = 30000;
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

async function saveCache() {
  try {
    await fs.promises.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    log.w('could not save label cache: ' + e.message);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    if (dirty) {
      dirty = false;
      await saveCache();
    }
  }, SAVE_DELAY);
}

function getCachedLabel(albumHash) {
  return cache[albumHash] !== undefined ? cache[albumHash] : null;
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

const LABEL_NATIVE_TAGS = new Set([
  'label',
  'record label',
  'publisher',
  'organization'
]);

function getLabelFromNative(native) {
  if (!native) return null;
  for (const format of Object.keys(native)) {
    for (const tag of native[format]) {
      if (tag && tag.id && LABEL_NATIVE_TAGS.has(tag.id.toLowerCase())) {
        const val = tag.value;
        if (val) {
          return Array.isArray(val) ? val.filter(Boolean).join(', ') : String(val);
        }
      }
    }
  }
  return null;
}

async function extractLabelFromFile(filePath) {
  try {
    const meta = await musicMetadata.parseFile(filePath, { duration: false, skipCovers: true });
    return getLabelFromCommon(meta.common) || getLabelFromNative(meta.native) || null;
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

  // Only consider albums that are not already cached, so repeated
  // LibraryGet calls do not re-scan the whole library.
  const toProcess = [];
  for (const album of albums) {
    if (!album || !album['@_hash']) continue;
    if (!album['LibraryFile']) continue;
    if (cache[album['@_hash']] !== undefined) continue;
    toProcess.push(album);
  }

  if (toProcess.length === 0) {
    return;
  }

  log.i('label extraction started: ' + toProcess.length + ' uncached albums');

  // Bounded concurrency so we do not open an unbounded number of files.
  const CONCURRENCY = 4;
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= toProcess.length) return;
      const album = toProcess[index];

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
  };

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  log.i('label extraction finished: ' + toProcess.length + ' processed');
}

loadCache();

module.exports = {
  injectLabels,
  backgroundEnsureLabels,
  getCachedLabel,
  getLabelFromCommon,
  extractLabelFromFile
};
