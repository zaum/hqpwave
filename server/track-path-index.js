const fs = require('fs');
const path = require('path');
const log = require('./log');

const INDEX_FILE = path.resolve(__dirname, '..', 'hqpwv-track-paths.json');

let hashToPath = {};
let albumPaths = {};
let syncedAlbums = new Set();
let isDirty = false;
let saveTimeout = null;
const SAVE_DELAY = 5000;

function loadIndex() {
  try {
    if (fs.existsSync(INDEX_FILE)) {
      const raw = fs.readFileSync(INDEX_FILE, 'utf8');
      const data = JSON.parse(raw);
      hashToPath = data.paths || {};
      albumPaths = data.albumPaths || {};
      syncedAlbums = new Set(data.syncedAlbums || []);
      log.x('track path index loaded: ' + Object.keys(hashToPath).length + ' entries, ' + syncedAlbums.size + ' synced');
    }
  } catch (e) {
    log.w('could not load track path index: ' + e.message);
    hashToPath = {};
    syncedAlbums = new Set();
  }
}

function saveIndex() {
  try {
    const data = {
      paths: hashToPath,
      albumPaths: albumPaths,
      syncedAlbums: Array.from(syncedAlbums)
    };
    fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2), 'utf8');
    isDirty = false;
  } catch (e) {
    log.w('could not save track path index: ' + e.message);
  }
}

function scheduleSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    if (isDirty) {
      saveIndex();
    }
  }, SAVE_DELAY);
}

function normalizeFilePath(rawPath) {
  let p = rawPath || '';
  try { p = decodeURIComponent(p); } catch (e) {}
  p = p.trim().replace(/^file:\/+/i, '');
  if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
  if (process.platform === 'win32' && /^[a-zA-Z]\|/.test(p)) p = p.replace(/^([a-zA-Z])\|/, '$1:');
  return path.normalize(p);
}

function buildIndex(json) {
  const dirs = json?.['LibraryGet']?.['LibraryDirectory'];
  if (!dirs) return;

  const albums = Array.isArray(dirs) ? dirs : [dirs];
  let count = 0;

  const newSyncedAlbums = new Set();

  for (const album of albums) {
    if (!album || !album['@_hash'] || !album['LibraryFile']) continue;

    const albumHash = album['@_hash'];
    const albumPath = normalizeFilePath(album['@_path'] || '');
    if (!albumPath) continue;

    albumPaths[albumHash] = albumPath;

    if (syncedAlbums.has(albumHash)) {
      newSyncedAlbums.add(albumHash);
    }

    const tracks = Array.isArray(album['LibraryFile']) ? album['LibraryFile'] : [album['LibraryFile']];

    for (const track of tracks) {
      const trackName = track['@_name'];
      const trackHash = track['@_hash'];
      if (!trackName || !trackHash) continue;

      const fullHash = albumHash + '_' + trackHash;
      hashToPath[fullHash] = path.join(albumPath, trackName);
      count++;
    }
  }

  syncedAlbums = newSyncedAlbums;

  log.x('track path index built: ' + count + ' entries, ' + syncedAlbums.size + ' already synced');
  isDirty = true;
  scheduleSave();
}

function getTrackPath(trackHash) {
  return hashToPath[trackHash] || null;
}

function getAlbumPath(albumHash) {
  return albumPaths[albumHash] || null;
}

function getTrackHashFromPath(filePath) {
  const normalized = path.normalize(filePath);
  for (const [hash, p] of Object.entries(hashToPath)) {
    if (path.normalize(p) === normalized) {
      return hash;
    }
  }
  return null;
}

function isAlbumSynced(albumHash) {
  return syncedAlbums.has(albumHash);
}

function markAlbumSynced(albumHash) {
  syncedAlbums.add(albumHash);
  isDirty = true;
  scheduleSave();
}

function getTracksByAlbumHash(albumHash) {
  const prefix = albumHash + '_';
  const result = [];
  for (const [key, filePath] of Object.entries(hashToPath)) {
    if (key.startsWith(prefix)) {
      const trackHash = key.substring(prefix.length);
      result.push({ trackHash, fullHash: key, filePath });
    }
  }
  return result;
}

function getEntryCount() {
  return Object.keys(hashToPath).length;
}

function getSyncedCount() {
  return syncedAlbums.size;
}

loadIndex();

module.exports = {
  buildIndex,
  getTrackPath,
  getTrackHashFromPath,
  getTracksByAlbumHash,
  getAlbumPath,
  isAlbumSynced,
  markAlbumSynced,
  getEntryCount,
  getSyncedCount
};
