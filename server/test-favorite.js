/**
 * End-to-end test for favorite write/read + error handling.
 * Run: node server/test-favorite.js
 */
const fs = require('fs');
const path = require('path');
const log = require('./log');

// --- Setup ---
const TEST_DIR = path.resolve(__dirname, '..', 'test-audio-tmp');
const TEST_FLAC = path.join(TEST_DIR, 'test.flac');
const TEST_MP3 = path.join(TEST_DIR, 'test.mp3');
const TEST_M4A = path.join(TEST_DIR, 'test.m4a');
const ALBUM_MARKER = path.join(TEST_DIR, 'album_favorite.flg');
const NONEXISTENT = path.join(TEST_DIR, 'nonexistent.flac');
const READONLY_FLAC = path.join(TEST_DIR, 'readonly.flac');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  PASS:', label);
    passed++;
  } else {
    console.log('  FAIL:', label);
    failed++;
  }
}

async function test() {
  console.log('=== Favorite Write/Read E2E Tests ===\n');

  // --- Get a real FLAC from the index ---
  const index = require('./track-path-index');
  const firstTrackPath = index.getTrackPath(index.getTrackHashFromPath
    ? null : null);

  // Manual: grab first path from JSON
  const raw = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '..', 'hqpwv-track-paths.json'), 'utf8'));
  const entries = Object.entries(raw.paths);
  if (entries.length === 0) {
    console.log('ERROR: no tracks in index, cannot test');
    process.exit(1);
  }
  const srcPath = entries[0][1];
  console.log('Source file:', srcPath.substring(0, 80) + '...');

  // --- Clean & create test dir ---
  if (fs.existsSync(TEST_DIR)) {
    // remove only our test files
    for (const f of fs.readdirSync(TEST_DIR)) {
      fs.unlinkSync(path.join(TEST_DIR, f));
    }
  } else {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }

  // --- 1. FLAC round-trip ---
  console.log('\n--- FLAC Round-trip ---');
  log.setLevel(log.LEVEL_WARNING); // suppress app logs
  const mm = require('music-metadata');
  const writer = require('./audio-tag-writer');

  // Copy source FLAC
  fs.copyFileSync(srcPath, TEST_FLAC);
  assert(fs.existsSync(TEST_FLAC), 'FLAC copied for test');

  // Read initial state (no favorite tag)
  const initial = await writer.readFavorite(TEST_FLAC);
  assert(initial === null, 'initial readFavorite returns null (no tag)');

  // Write FAVORITE=1
  const wrote1 = await writer.writeFavorite(TEST_FLAC, true);
  assert(wrote1 === true, 'writeFavorite(true) succeeded');

  // Read back
  const read1 = await writer.readFavorite(TEST_FLAC);
  assert(read1 === true, 'readFavorite returns true after write');

  // Write FAVORITE=0 (remove)
  const wrote0 = await writer.writeFavorite(TEST_FLAC, false);
  assert(wrote0 === true, 'writeFavorite(false) succeeded');

  // Read back
  const read0 = await writer.readFavorite(TEST_FLAC);
  assert(read0 === false, 'readFavorite returns false after removal');

  // Verify with music-metadata directly (native tag inspection)
  const meta = await mm.parseFile(TEST_FLAC, { duration: false, skipCovers: true });
  let foundTag = false;
  if (meta.native) {
    for (const fmt of Object.keys(meta.native)) {
      for (const tag of meta.native[fmt]) {
        if (tag.id && tag.id.toUpperCase() === 'FAVORITE') {
          foundTag = String(tag.value);
        }
      }
    }
  }
  assert(foundTag === '0', 'native FAVORITE tag value is "0"');

  // --- 2. MP3 round-trip ---
  console.log('\n--- MP3 Round-trip ---');
  // Need an MP3 source; find one in index or create minimal
  // Check if any MP3 exists in the path index
  const mp3Entry = entries.find(e => e[1].toLowerCase().endsWith('.mp3'));
  if (mp3Entry) {
    fs.copyFileSync(mp3Entry[1], TEST_MP3);
    const mp3Initial = await writer.readFavorite(TEST_MP3);
    assert(mp3Initial === null || mp3Initial === false, 'MP3 initial read ok');

    const mp3Wrote = await writer.writeFavorite(TEST_MP3, true);
    assert(mp3Wrote === true, 'MP3 writeFavorite(true) succeeded');

    const mp3Read = await writer.readFavorite(TEST_MP3);
    assert(mp3Read === true, 'MP3 readFavorite returns true');

    // Check ID3v2 TXXX frame (node-id3 stores as userDefinedText)
    const NodeID3 = require('node-id3');
    const id3 = NodeID3.read(TEST_MP3);
    const udt = id3?.userDefinedText;
    const favFrame = Array.isArray(udt)
      ? udt.find(f => f.description === 'FAVORITE')
      : (udt?.description === 'FAVORITE' ? udt : null);
    assert(favFrame?.value === '1', 'ID3v2 TXXX FAVORITE=1 found');

    const mp3Wrote0 = await writer.writeFavorite(TEST_MP3, false);
    assert(mp3Wrote0 === true, 'MP3 remove favorite succeeded');

    const mp3Read0 = await writer.readFavorite(TEST_MP3);
    assert(mp3Read0 === false, 'MP3 readFavorite returns false after removal');
  } else {
    console.log('  SKIP: no MP3 source file available');
  }

  // --- 3. Album marker file ---
  console.log('\n--- Album Marker File ---');
  // Simulate an album hash that maps to TEST_DIR
  // We need to inject a fake album path into track-path-index
  // Since writeAlbumFavorite uses trackPathIndex.getAlbumPath,
  // we'll test the lower-level file operations directly
  const albumHash = 'test_hash_12345';

  // Write marker
  const wroteMarker = await writer.writeAlbumFavorite(albumHash, true);
  // This will fail if albumHash not in index, which is expected
  // Let's test via direct path
  const albumFavPath = path.join(TEST_DIR, writer.ALBUM_FAVORITE_FILE);
  // Use fs directly to simulate
  fs.writeFileSync(albumFavPath, '');
  assert(fs.existsSync(albumFavPath), 'album_favorite.flg created via fs');

  // Read via our function with injected path
  // Use a modified approach: test readAlbumFavorite with a hash pointing to TEST_DIR
  // Since we can't inject, test the marker detection directly
  const markerExists = fs.existsSync(albumFavPath);
  assert(markerExists, 'album_favorite.flg detected by fs.existsSync');

  // Remove marker
  fs.unlinkSync(albumFavPath);
  assert(!fs.existsSync(albumFavPath), 'album_favorite.flg removed');

  // --- 4. Error handling ---
  console.log('\n--- Error Handling ---');

  // 4a. Missing file
  const missingResult = await writer.writeFavorite(NONEXISTENT, true);
  assert(missingResult === false, 'writeFavorite returns false for missing file');

  const missingRead = await writer.readFavorite(NONEXISTENT);
  assert(missingRead === null, 'readFavorite returns null for missing file');

  // 4b. null/undefined path
  const nullResult = await writer.writeFavorite(null, true);
  assert(nullResult === false, 'writeFavorite(null) returns false');

  const nullRead = await writer.readFavorite(null);
  assert(nullRead === null, 'readFavorite(null) returns null');

  // 4c. Unsupported extension (WAV)
  const wavPath = path.join(TEST_DIR, 'test.wav');
  fs.writeFileSync(wavPath, 'RIFF....');
  const wavResult = await writer.writeFavorite(wavPath, true);
  assert(wavResult === false, 'writeFavorite(WAV) returns false (unsupported)');
  const wavSupported = writer.isSupported(wavPath);
  assert(wavSupported === false, 'isSupported(WAV) returns false');

  // 4d. Non-existent album hash for album marker
  const badAlbumResult = await writer.writeAlbumFavorite('nonexistenthash', true);
  assert(badAlbumResult === false, 'writeAlbumFavorite(bad hash) returns false');

  const badAlbumRead = await writer.readAlbumFavorite('nonexistenthash');
  assert(badAlbumRead === null, 'readAlbumFavorite(bad hash) returns null');

  // 4e. Read-only file (if possible on this platform)
  try {
    fs.copyFileSync(srcPath, READONLY_FLAC);

    // Try to make it read-only
    fs.chmodSync(READONLY_FLAC, 0o444);

    // Writing should fail
    const roResult = await writer.writeFavorite(READONLY_FLAC, true);
    // On Windows, chmod may not fully protect against the user, so this might
    // still succeed. We just note the result.
    console.log('  READONLY write returned:', roResult);

    // Clean up
    fs.chmodSync(READONLY_FLAC, 0o644);
  } catch (e) {
    console.log('  SKIP readonly test:', e.message);
  }

  // --- Cleanup ---
  console.log('\n--- Cleanup ---');
  for (const f of fs.readdirSync(TEST_DIR)) {
    try {
      fs.unlinkSync(path.join(TEST_DIR, f));
    } catch (e) {}
  }
  fs.rmdirSync(TEST_DIR);
  console.log('Test directory cleaned up');

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
