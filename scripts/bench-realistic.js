/**
 * Realistic before/after measurement using the ACTUAL track-path index
 * hashes from hqpwv-track-paths.json. Reconstructs a LibraryGet-shaped
 * JSON from the real hashToPath map, then measures:
 *   - first buildIndex (simulates a LibraryGet after library change)
 *   - second buildIndex on identical data (simulates a *repeat* LibraryGet
 *     with no changes -> should skip the expensive 3.9MB JSON write)
 *
 * This isolates the set-diff + skip-save optimization without needing a
 * live HQPlayer connection.
 *
 * Usage: node scripts/bench-realistic.js
 */

const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const trackPathIndex = require(path.join(SERVER_DIR, 'track-path-index'));
const INDEX_FILE = path.resolve(SERVER_DIR, '..', 'hqpwv-track-paths.json');

function reconstructLibraryFromIndex() {
  const raw = fs.readFileSync(INDEX_FILE, 'utf8');
  const data = JSON.parse(raw);
  const hashToPath = data.paths || {};
  const albumPaths = data.albumPaths || {};

  // Group full-hash keys by album hash.
  const albumsMap = {};
  for (const fullHash in hashToPath) {
    const idx = fullHash.indexOf('_');
    if (idx < 0) continue;
    const albumHash = fullHash.substring(0, idx);
    const trackHash = fullHash.substring(idx + 1);
    const fullPath = hashToPath[fullHash];
    const trackName = path.basename(fullPath);
    if (!albumsMap[albumHash]) {
      albumsMap[albumHash] = {
        '@_hash': albumHash,
        '@_path': albumPaths[albumHash] || path.dirname(fullPath),
        'LibraryFile': []
      };
    }
    albumsMap[albumHash]['LibraryFile'].push({ '@_name': trackName, '@_hash': trackHash });
  }

  const dirs = Object.values(albumsMap);
  return { LibraryGet: { LibraryDirectory: dirs } };
}

function measure(label, fn) {
  const t0 = process.hrtime.bigint();
  fn();
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  console.log(label + ': ' + ms.toFixed(2) + ' ms');
  return ms;
}

console.log('--- realistic buildIndex measurement ---');
const json = reconstructLibraryFromIndex();
console.log('reconstructed albums: ' + json.LibraryGet.LibraryDirectory.length);
console.log('real index entries: ' + trackPathIndex.getEntryCount());

// Prevent real disk writes (30s SAVE_DELAY means the process exits first,
// but be explicit anyway by not awaiting).
measure('FIRST buildIndex (library changed)', () => {
  trackPathIndex.buildIndex(json);
});

measure('SECOND buildIndex (repeat, unchanged -> skip save)', () => {
  trackPathIndex.buildIndex(json);
});

console.log('--- done ---');
