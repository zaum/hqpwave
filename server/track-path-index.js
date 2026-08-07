const fs = require('fs');
const path = require('path');
const log = require('./log');
const { normalizeFilePath } = require('./file-util');

const INDEX_FILE = path.resolve(__dirname, '..', 'hqpwv-track-paths.json');

let hashToPath = {};
let albumPaths = {};
let albumToTracks = {};
let pathToHash = {};
let syncedAlbums = new Set();
let isDirty = false;
let saveTimeout = null;
const SAVE_DELAY = 30000;

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

async function saveIndex() {
  try {
    const data = {
      paths: hashToPath,
      albumPaths: albumPaths,
      syncedAlbums: Array.from(syncedAlbums)
    };
    await fs.promises.writeFile(INDEX_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    log.w('could not save track path index: ' + e.message);
  }
}

function scheduleSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(async () => {
    if (isDirty) {
      isDirty = false;
      await saveIndex();
    }
  }, SAVE_DELAY);
}

function buildIndex(json) {
  const dirs = json?.['LibraryGet']?.['LibraryDirectory'];
  if (!dirs) return;

  const albums = Array.isArray(dirs) ? dirs : [dirs];

  // Build the incoming entry set so we can skip the (expensive) rewrite
  // when the library contents have not changed since the last build.
  const incomingEntries = {};
  const incomingAlbumPaths = {};
  const incomingAlbumToTracks = {};
  let count = 0;

  const newSyncedAlbums = new Set();

  for (const album of albums) {
    if (!album || !album['@_hash'] || !album['LibraryFile']) continue;

    const albumHash = album['@_hash'];
    const albumPath = normalizeFilePath(album['@_path'] || '');
    if (!albumPath) continue;

    incomingAlbumPaths[albumHash] = albumPath;

    if (syncedAlbums.has(albumHash)) {
      newSyncedAlbums.add(albumHash);
    }

    const tracks = Array.isArray(album['LibraryFile']) ? album['LibraryFile'] : [album['LibraryFile']];

    for (const track of tracks) {
      const trackName = track['@_name'];
      const trackHash = track['@_hash'];
      if (!trackName || !trackHash) continue;

      const fullHash = albumHash + '_' + trackHash;
      const fullPath = path.join(albumPath, trackName);
      incomingEntries[fullHash] = fullPath;
      if (!incomingAlbumToTracks[albumHash]) incomingAlbumToTracks[albumHash] = [];
      incomingAlbumToTracks[albumHash].push({ trackHash, fullHash, filePath: fullPath });
      count++;
    }
  }

  // Detect whether anything actually changed before mutating state.
  const entriesChanged =
    Object.keys(incomingEntries).length !== Object.keys(hashToPath).length ||
    Object.keys(incomingAlbumPaths).length !== Object.keys(albumPaths).length;
  let dirty = entriesChanged;
  if (!entriesChanged) {
    for (const key in incomingEntries) {
      if (hashToPath[key] !== incomingEntries[key]) {
        dirty = true;
        break;
      }
    }
    if (!dirty) {
      for (const key in incomingAlbumPaths) {
        if (albumPaths[key] !== incomingAlbumPaths[key]) {
          dirty = true;
          break;
        }
      }
    }
  }

  // Always adopt the freshly computed maps (cheap object assign) so the
  // in-memory index stays correct even when we skip persisting.
  hashToPath = incomingEntries;
  albumPaths = incomingAlbumPaths;
  albumToTracks = incomingAlbumToTracks;
  // Rebuild reverse path->hash map for O(1) lookups.
  const incomingPathToHash = {};
  for (const key in incomingEntries) {
    incomingPathToHash[path.normalize(incomingEntries[key])] = key;
  }
  pathToHash = incomingPathToHash;
  syncedAlbums = newSyncedAlbums;

  log.x('track path index built: ' + count + ' entries, ' + syncedAlbums.size + ' already synced' + (dirty ? '' : ' (unchanged, skip save)'));
  if (dirty) {
    isDirty = true;
    scheduleSave();
  }
}

function getTrackPath(trackHash) {
  return hashToPath[trackHash] || null;
}

function getAlbumPath(albumHash) {
  return albumPaths[albumHash] || null;
}

function getTrackHashFromPath(filePath) {
  const normalized = path.normalize(filePath);
  return pathToHash[normalized] || null;
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
  const tracks = albumToTracks[albumHash];
  if (!tracks) return [];
  return tracks.map(t => ({ trackHash: t.trackHash, fullHash: t.fullHash, filePath: t.filePath }));
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
