const fs = require('fs');
const path = require('path');
const log = require('./log');
const trackPathIndex = require('./track-path-index');

let musicMetadata = null;
try {
  musicMetadata = require('music-metadata');
} catch (e) {
  log.w('music-metadata not available');
}

let Metaflac = null;
try {
  Metaflac = require('metaflac-js');
} catch (e) {
  log.w('metaflac-js not available, FLAC tag writing disabled');
}

let NodeID3 = null;
try {
  NodeID3 = require('node-id3');
} catch (e) {
  log.w('node-id3 not available, ID3 tag writing disabled');
}

const FAVORITE_TAG = 'FAVORITE';
const ALBUM_FAVORITE_FILE = 'album_favorite.flg';
const SUPPORTED_EXTENSIONS = new Set([
  '.flac',
  '.mp3', '.mp2',
  '.dsf', '.dff',
  '.aiff', '.aif',
  '.m4a', '.mp4', '.alac',
  '.ogg', '.oga'
]);

function getFileExtension(filePath) {
  return path.extname(filePath || '').toLowerCase();
}

function isSupported(filePath) {
  return SUPPORTED_EXTENSIONS.has(getFileExtension(filePath));
}

async function readFavorite(filePath) {
  if (!filePath || !musicMetadata) return null;
  if (!fs.existsSync(filePath)) return null;

  try {
    const meta = await musicMetadata.parseFile(filePath, { duration: false, skipCovers: true });

    if (meta.common && meta.common.label) {
      const label = Array.isArray(meta.common.label) ? meta.common.label : [meta.common.label];
      for (const item of label) {
        if (typeof item === 'string' && item.toUpperCase() === 'FAVORITE=1') return true;
      }
    }

    const native = meta.native;
    if (!native) return null;

    for (const format of Object.keys(native)) {
      for (const tag of native[format]) {
        if (!tag || !tag.id) continue;
        const tagId = tag.id.toUpperCase();
        if (tagId === FAVORITE_TAG || tagId.endsWith(':' + FAVORITE_TAG)) {
          const val = Array.isArray(tag.value) ? tag.value[0] : tag.value;
          const str = String(val || '');
          if (str === '1') return true;
          if (str === '0') return false;
        }
      }
    }

    return null;
  } catch (e) {
    log.w('readFavorite error: ' + filePath + ' - ' + e.message);
    return null;
  }
}

async function writeFavorite(filePath, isFavorite) {
  if (!filePath || !isSupported(filePath)) return false;
  if (!fs.existsSync(filePath)) return false;

  const ext = getFileExtension(filePath);
  let result = false;

  if ((ext === '.flac' || ext === '.ogg' || ext === '.oga') && Metaflac) {
    result = await writeFavoriteFlac(filePath, isFavorite);
  } else if ((ext === '.mp3' || ext === '.mp2' || ext === '.dsf' || ext === '.dff' || ext === '.aiff' || ext === '.aif' || ext === '.m4a' || ext === '.mp4' || ext === '.alac') && NodeID3) {
    result = await writeFavoriteId3(filePath, isFavorite);
  }

  if (result) {
    log.i('favorite ' + (isFavorite ? 'set' : 'removed') + ' in: ' + filePath);
  }
  return result;
}

async function writeFavoriteFlac(filePath, isFavorite) {
  try {
    const flac = new Metaflac(filePath);
    flac.removeTag(FAVORITE_TAG);
    flac.setTag(FAVORITE_TAG + '=' + (isFavorite ? '1' : '0'));
    if (!flac.padding) {
      flac.padding = Buffer.alloc(8192);
    }
    flac.save();
    return true;
  } catch (e) {
    log.w('failed to write FLAC tag: ' + filePath + ' - ' + e.message);
    return false;
  }
}

async function writeFavoriteId3(filePath, isFavorite) {
  try {
    const value = isFavorite ? '1' : '0';
    NodeID3.update({
      TXXX: [{ description: FAVORITE_TAG, value: value }]
    }, filePath);
    return true;
  } catch (e) {
    log.w('failed to write ID3 tag: ' + filePath + ' - ' + e.message);
    return false;
  }
}

async function backgroundSyncFavorites(json) {
  try {
    const dirs = json?.['LibraryGet']?.['LibraryDirectory'];
    if (!dirs) return;

  const meta = require('./meta');
  if (!meta.getIsEnabled()) return;

  const metaData = meta.getData();
  const tracks = metaData?.['tracks-r2'];
  if (!tracks) return;

  for (const album of albums) {
    try {
      if (!album || !album['@_hash'] || !album['LibraryFile']) continue;

      const albumHash = album['@_hash'];
      if (trackPathIndex.isAlbumSynced(albumHash)) {
        skipped++;
        continue;
      }
      const albumFav = await readAlbumFavorite(albumHash);
      if (albumFav === true) {
        const albumEntry = metaData['albums']?.[albumHash];
        if (!albumEntry || !albumEntry['favorite']) {
          if (!metaData['albums']) metaData['albums'] = {};
          if (!metaData['albums'][albumHash]) metaData['albums'][albumHash] = {};
          metaData['albums'][albumHash]['favorite'] = true;
          synced++;
        }
      }

      const albumTracks = Array.isArray(album['LibraryFile']) ? album['LibraryFile'] : [album['LibraryFile']];

      let albumHadFavorite = albumFav === true;

      for (const track of albumTracks) {
        const trackName = track['@_name'];
        const trackHash = track['@_hash'];
        if (!trackName || !trackHash) continue;

        const fullHash = albumHash + '_' + trackHash;
        const filePath = trackPathIndex.getTrackPath(fullHash);
        if (!filePath) continue;

        const fileFav = await readFavorite(filePath);
        if (fileFav === null) continue;

        const existing = tracks[fullHash];
        const currentFav = existing ? existing['favorite'] : false;

        if (fileFav !== currentFav) {
          tracks[fullHash] = tracks[fullHash] || {};
          tracks[fullHash]['favorite'] = fileFav;
          synced++;
        }

        if (fileFav) {
          albumHadFavorite = true;
        }
      }

      if (albumHadFavorite) {
        const albumEntry = metaData['albums']?.[albumHash];
        if (!albumEntry || !albumEntry['favorite']) {
          if (!metaData['albums']) metaData['albums'] = {};
          if (!metaData['albums'][albumHash]) metaData['albums'][albumHash] = {};
          metaData['albums'][albumHash]['favorite'] = true;
          synced++;
        }
      }

      trackPathIndex.markAlbumSynced(albumHash);
      processed++;
    } catch (e) {
      log.w('background sync error for album ' + (album?.['@_hash'] || 'unknown') + ': ' + e.message);
    }
  }

  if (synced > 0) {
    meta.saveFile();
    log.i('favorite sync from audio files: ' + synced + ' updated, ' + processed + ' processed, ' + skipped + ' skipped');
  } else {
    if (processed > 0) {
      log.i('favorite sync from audio files: ' + processed + ' albums checked, no favorites found, ' + skipped + ' skipped');
    }
  }
  } catch (e) {
    log.w('background sync error: ' + e.message);
  }
}

function getAlbumFavoritePath(albumHash) {
  const albumPath = trackPathIndex.getAlbumPath(albumHash);
  if (!albumPath) return null;
  return path.join(albumPath, ALBUM_FAVORITE_FILE);
}

async function writeAlbumFavorite(albumHash, isFavorite) {
  const filePath = getAlbumFavoritePath(albumHash);
  if (!filePath) return false;
  try {
    if (isFavorite) {
      fs.writeFileSync(filePath, '');
    } else {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    return true;
  } catch (e) {
    log.w('failed to write album favorite: ' + e.message);
    return false;
  }
}

async function readAlbumFavorite(albumHash) {
  const filePath = getAlbumFavoritePath(albumHash);
  if (!filePath) return null;
  try {
    return fs.existsSync(filePath);
  } catch (e) {
    return null;
  }
}

module.exports = {
  writeFavorite,
  readFavorite,
  isSupported,
  writeAlbumFavorite,
  readAlbumFavorite,
  backgroundSyncFavorites,
  FAVORITE_TAG,
  ALBUM_FAVORITE_FILE
};
