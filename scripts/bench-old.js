/**
 * Benchmark using the PRE-refactor (git HEAD) server modules, for
 * before/after comparison. Loads modules from a temp dir so the real
 * production JSON files are never touched.
 *
 * Usage: node scripts/bench-old.js [albums] [tracksPerAlbum]
 */

const path = require('path');
const OLD_DIR = 'C:\\Users\\peter\\AppData\\Local\\Temp\\opencode\\bench_old';

const ALBUMS = parseInt(process.argv[2], 10) || 5000;
const TRACKS = parseInt(process.argv[3], 10) || 20;

const labelCache = require(path.join(OLD_DIR, 'label-cache.js'));
const trackPathIndex = require(path.join(OLD_DIR, 'track-path-index.js'));
const audioTagWriter = require(path.join(OLD_DIR, 'audio-tag-writer.js'));
const meta = require(path.join(OLD_DIR, 'meta.js'));

function makeSyntheticLibrary(albumCount, tracksPerAlbum) {
  const dirs = [];
  for (let a = 0; a < albumCount; a++) {
    const albumHash = 'album' + a;
    const files = [];
    for (let t = 0; t < tracksPerAlbum; t++) {
      files.push({ '@_name': 'track' + t + '.flac', '@_hash': 'th' + a + '_' + t });
    }
    dirs.push({
      '@_hash': albumHash,
      '@_path': '/music/artist' + (a % 500) + '/album' + a,
      '@_artist': 'Artist' + (a % 500),
      '@_album': 'Album' + a,
      'LibraryFile': files
    });
  }
  return { LibraryGet: { LibraryDirectory: dirs } };
}

async function run() {
  console.log('--- PRE-refactor (HEAD) benchmark ---');
  console.log('albums=' + ALBUMS + ' tracksPerAlbum=' + TRACKS);
  console.log('index entries before: ' + trackPathIndex.getEntryCount());

  const json = makeSyntheticLibrary(ALBUMS, TRACKS);

  const t0 = process.hrtime.bigint();
  labelCache.injectLabels(json);
  trackPathIndex.buildIndex(json);
  const t1 = process.hrtime.bigint();
  const syncMs = Number(t1 - t0) / 1e6;
  console.log('SYNC injectLabels + buildIndex (FIRST): ' + syncMs.toFixed(2) + ' ms');

  // Repeat: PRE-refactor always re-marks dirty + schedules save.
  const t2 = process.hrtime.bigint();
  labelCache.injectLabels(json);
  trackPathIndex.buildIndex(json);
  const t3 = process.hrtime.bigint();
  const syncMs2 = Number(t3 - t2) / 1e6;
  console.log('SYNC injectLabels + buildIndex (REPEAT): ' + syncMs2.toFixed(2) + ' ms [PRE always marks dirty -> will rewrite 3.9MB JSON in 30s]');

  const b0 = process.hrtime.bigint();
  await labelCache.backgroundEnsureLabels(json);
  await audioTagWriter.backgroundSyncFavorites(json);
  const b1 = process.hrtime.bigint();
  const ioMs = Number(b1 - b0) / 1e6;
  console.log('ASYNC backgroundEnsureLabels + backgroundSyncFavorites: ' + ioMs.toFixed(2) + ' ms');

  console.log('index entries after: ' + trackPathIndex.getEntryCount());
  console.log('--- done ---');
}

run().catch(e => { console.error('benchmark failed:', e); process.exit(1); });
