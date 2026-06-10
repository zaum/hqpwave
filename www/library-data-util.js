import HqpConfigModel from './hqp-config-model.js';
import MetaUtil from './meta-util.js';
import Settings from './settings.js';
import Util from './util.js';

/**
 *
 */
export default class LibraryDataUtil {

  static makeFilteredAlbumsArray(albums, filterType) {
    let result = [];
    if (filterType == 'favorites') {
      for (const album of albums) {
        const hash = album['@_hash'];
        const b = MetaUtil.isAlbumFavoriteFor(hash);
        if (b) {
          result.push(album);
        }
      }
    } else {
      result = [...albums];
    }
    return result;

    // if (!album['LibraryFile']) {
    //   continue;
    // }
  }

  static sortByArtistThenAlbum(o1, o2) {
    let result = LibraryDataUtil.sortByArtist(o1, o2);
    if (result != 0) {
      return result;
    } else {
      return LibraryDataUtil.sortByAlbum(o1, o2);
    }
  };

  static sortByAlbumThenArtist(o1, o2) {
    let result = LibraryDataUtil.sortByAlbum(o1, o2);
    if (result != 0) {
      return result;
    } else {
      return LibraryDataUtil.sortByArtist(o1, o2);
    }
  }

  static sortByArtist(o1, o2) {
    const a = (o1['@_artist'] || '').toLowerCase();
    const b = (o2['@_artist'] || '').toLowerCase();
    return a == b ? 0 : a > b ? 1 : -1;
  };

  static sortByAlbum(o1, o2) {
    const a = (o1['@_album'] || '').toLowerCase();
    const b = (o2['@_album'] || '').toLowerCase();
    return a == b ? 0 : a > b ? 1 : -1;
  }

  static sortByPath(o1, o2) {
    const a = o1['@_path'];
    const b = o2['@_path'];
    return a == b ? 0 : a > b ? 1 : -1;
  }

  /**
   * Sort by date added (most recent first).
   * Uses album's position in the original array as a proxy for date added,
   * since HQPlayer doesn't provide an explicit date added field.
   * Assumes albums are added in order, with newer albums at higher indices.
   */
  static sortByDateAddedDesc(o1, o2) {
    // Use the _originalIndex if set, otherwise fall back to other comparison
    const a = o1['_originalIndex'] || 0;
    const b = o2['_originalIndex'] || 0;
    return b - a; // Descending: newer (higher index) first
  }

  /**
   * Sort by release date (year) descending - newest first.
   */
  static sortByReleaseDateDesc(o1, o2) {
    const a = parseInt(o1['year']) || 0;
    const b = parseInt(o2['year']) || 0;
    if (a === b) {
      // Fall back to artist/album sort for same year
      return LibraryDataUtil.sortByArtistThenAlbum(o1, o2);
    }
    return b - a; // Descending: higher year first
  }

  /**
   * Wraps a comparator function and reverses its result when direction is 'desc'.
   */
  static withDirection(comparator, direction) {
    if (direction === 'desc') {
      return (o1, o2) => comparator(o2, o1);
    }
    return comparator;
  }
}
