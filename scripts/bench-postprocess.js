/**
 * Benchmark for postProcessLibrary path (LibraryGet handling).
 *
 * Measures:
 *   1. Synchronous part: injectLabels + trackPathIndex.buildIndex
 *   2. Background I/O part (optional): labelCache.backgroundEnsureLabels,
 *      audioTagWriter.backgroundSyncFavorites
 *
 * Usage:
 *   node scripts/bench-postprocess.js [albums] [tracksPerAlbum] [--no-io]
 *
 * Examples:
 *   node scripts/bench-postprocess.js            # default 2000 albums, 12 tracks
 *   node scripts/bench-postprocess.js 5000 20    # 5000 albums, 20 tracks each
 *   node scripts/bench-postprocess.js 2000 12 --no-io
 *
 * Note: the background I/O phase opens real audio files only if the
 * track-path-index actually resolves paths to existing files. With a
 * synthetic library (paths that do not exist on disk) the file I/O is a
 * no-op and the measurement reflects the iteration/dispatch overhead.
 */

const path = require('path');

const ALBUMS = parseInt(process.argv[2], 10) || 2000;
const TRACKS = parseInt(process.argv[3], 10) || 12;
const NO_IO = process.argv.includes('--no-io');

const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const proxy = require(path.join(SERVER_DIR, 'proxy'));
const trackPathIndex = require(path.join(SERVER_DIR, 'track-path-index'));
const labelCache = require(path.join(SERVER_DIR, 'label-cache'));
const audioTagWriter = require(path.join(SERVER_DIR, 'audio-tag-writer'));

function makeSyntheticLibrary(albumCount, tracksPerAlbum) {
  const dirs = [];
  for (let a = 0; a < albumCount; a++) {
    const albumHash = 'album' + a;
    const files = [];
    for (let t = 0; t < tracksPerAlbum; t++) {
      files.push({
        '@_name': 'track' + t + '.flac',
        '@_hash': 'th' + a + '_' + t
      });
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
  console.log('--- postProcessLibrary benchmark ---');
  console.log('albums=' + ALBUMS + ' tracksPerAlbum=' + TRACKS + ' noIo=' + NO_IO);
  console.log('index entries before: ' + trackPathIndex.getEntryCount());
  console.log('synced before: ' + trackPathIndex.getSyncedCount());

  // NOTE: trackPathIndex and labelCache use a 30s SAVE_DELAY before writing.
  // This benchmark finishes well within that window and the process exits,
  // so the pending save timers never fire — the production JSON files on
  // disk are never modified by running this script.

  const json = makeSyntheticLibrary(ALBUMS, TRACKS);

  // 1. Synchronous part
  const t0 = process.hrtime.bigint();
  proxy.postProcessLibrarySyncForTest
    ? proxy.postProcessLibrarySyncForTest(json)
    : (labelCache.injectLabels(json), trackPathIndex.buildIndex(json));
  const t1 = process.hrtime.bigint();
  const syncMs = Number(t1 - t0) / 1e6;
  console.log('SYNC injectLabels + buildIndex: ' + syncMs.toFixed(2) + ' ms');

  // 2. Background I/O part (optional)
  if (!NO_IO) {
    const b0 = process.hrtime.bigint();
    await labelCache.backgroundEnsureLabels(json);
    await audioTagWriter.backgroundSyncFavorites(json);
    const b1 = process.hrtime.bigint();
    const ioMs = Number(b1 - b0) / 1e6;
    console.log('ASYNC backgroundEnsureLabels + backgroundSyncFavorites: ' + ioMs.toFixed(2) + ' ms');
  }

  console.log('index entries after: ' + trackPathIndex.getEntryCount());
  console.log('synced after: ' + trackPathIndex.getSyncedCount());
  console.log('--- done ---');
}

run().catch(e => {
  console.error('benchmark failed:', e);
  process.exit(1);
});
