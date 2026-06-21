import AlbumUtil from './album-util.js';
import AppUtil from './app-util.js';
import Util from './util.js';

/**
 * Value object wrapper around hqp <Library /> object.
 *
 * Stores separate lookup related info
 * or otherwise adds new properties directly to pre-existing objects.
 */
export default class LibraryVo {

  // Array of album items
  _albums;
  // Array of library playlist items
  _hqPlaylistItems;

  // Cache objects:
  /** Key is hash, value is library item (album) */
  _albumHashToAlbum;
  /** Key is uri, value is track hash. */
  _trackUriToTrackHash;
  /** Key is track hash, value is [track, album] */
  _trackHashLookup = null;
  /** Key is album path, value is album */
  _pathToItem;
  /** Alphabetized list of genre names */
  _genreNames;
  /** Alphabetized list of label names */
  _labelNames;
  /** True if labels are still being extracted in background */
  _labelsExtracting = false;

  constructor(responseObject=null) {
    // Get main array from response object
    let responseArray;
    if (!responseObject) {
      responseArray = [];
    } else if (responseObject['LibraryGet'] == undefined) {
      cl('warning missing expected property');
      responseArray = [];
    } else if (responseObject['LibraryGet'] == '') {
      cl('info library is empty');
      responseArray = [];
    } else {
      responseArray = responseObject['LibraryGet']['LibraryDirectory'];
      if (!responseArray) {
        cl('warning missing expected property');
        responseArray = []
      } else {
        if (!Array.isArray(responseArray)) {
          responseArray = [responseArray];
        }
      }
    }
    this._labelsExtracting = !!(responseObject && responseObject['@_labelsExtracting']);
    this.init(responseArray);
  }

  get labelsExtracting() {
    return this._labelsExtracting;
  }

  /** Direct access to albums array. */  // todo rename
  get albums() {
    return this._albums;
  }

  get hqpPlaylistItems() {
    return this._hqPlaylistItems
  }

  get genreNames() {
    return this._genreNames || [];
  }

  // @Nullable
  getAlbumByAlbumHash(hash) {
    if (!this._albumHashToAlbum) {  // lazy init
      this._albumHashToAlbum = {};
      for (const item of this._albums) {
        const key = item['@_hash'];
        this._albumHashToAlbum[key] = item;
      }
    }
    return this._albumHashToAlbum[hash];
  }
  
  getAlbumByTitleAndArtist(title, artist) {
    if (!this._albums || !title) return null;
    const t = title.toLowerCase();
    const ar = (artist || '').toLowerCase();
    return this._albums.find(a => {
      const at = (a['@_album'] || '').toLowerCase();
      if (at !== t) return false;
      if (!ar) return true;
      const aa = (a['@_artist'] || '').toLowerCase();
      const ap = (a['@_performer'] || '').toLowerCase();
      return aa === ar || ap === ar || aa.includes(ar) || ap.includes(ar);
    });
  }

  // @Nullable
  getTrackHashForTrackUri(uri) {
    if (!uri) {
      return null;
    }
    return this._trackUriToTrackHash[uri]
      || this._trackUriToTrackHash[Util.makeFileUri(uri)]
      || this._trackUriToTrackHash[Util.toComparableLocalPath(uri)]
      || null;
  }

  // @Nullable
  getHashForPlaylistItem(item) {
    if (!item) {
      cl('warning playlistitem is null');
      return null;
    }
    if (!item['@_uri']) {
      cl('warning playlistitem has no uri');
      return null;
    }
    const uri = item['@_uri'];
    return this.getTrackHashForTrackUri(uri);
  }

  /**
   * Returns array of two elements (track and its containing album), or null.
   */
  getTrackAndAlbumByHash(hash) {
    if (!this._trackHashLookup) {
      this.initTrackHashLookup(); // lazy init
    }
    return this._trackHashLookup[hash];
  }

  getTrackByHash(hash) {
    const a = this.getTrackAndAlbumByHash(hash);
    return a ? a[0] : null;
  }

  getAlbumByTrackHash(hash) {
    const a = this.getTrackAndAlbumByHash(hash);
    return a ? a[1] : null;
  }

  /**
   * Find library item that contains the given track
   * (Rem, a playlist item added via hqp does not have to exist in the library)
   *
   * uri example: "file:///Volumes/MUSICBIG/nZk/01_AZ.flac"
   * path example: "/Volumes/MUSICBIG/nZk" (MacOS)
   */
  getAlbumByTrackUri(uri) {
    if (!this._pathToItem) { // lazy init
      this._pathToItem = {};
      for (const item of this._albums) {
        const path = item['@_path'];
        this._pathToItem[path] = item;
        const comparablePath = Util.toComparableLocalPath(path);
        if (comparablePath) {
          this._pathToItem[comparablePath] = item;
        }
      }
    }
    let path = Util.toComparableLocalPath(uri);
    path = Util.stripFilenameFromPath(path);
    return this._pathToItem[path];
  }

  getTrackByUri(uri) {
    const hash = this.getTrackHashForTrackUri(uri);
    if (!hash) {
      return null;
    }
    return this.getTrackByHash(hash)
  }

  isAlbum(item) {
    return !!(item['LibraryFile']);
  }

  isPlaylist(item) {
    if (!!(item['LibraryFile'])) {
      return false;
    }
    const path = item['@_path'];
    if (!path) {
      cl('warning bad data', item);
      return false;
    }
    return path.includes('.m3u');
  }

  // ---

  init(responseArray) {
    // Separate items into albums and playlists
    this._albums = [];
    this._hqPlaylistItems = [];
    const seenHashes = new Set();

    for (let i = responseArray.length - 1; i >= 0; i--) {
      const item = responseArray[i];
      if (this.isAlbum(item)) {
        // Store original index for dateAdded sorting (higher index = more recently added)
        item['_originalIndex'] = i;
        if (!seenHashes.has(item['@_hash'])) {
          seenHashes.add(item['@_hash']);
          this._albums.push(item);
        }
      } else if (this.isPlaylist(item)) {
        this._hqPlaylistItems.push(item);
      } else {
        // Happens eg w/ PGGB'd albums converted to wv, which oftentimes drops all metadata
        // cl('info item is not album or playlist, ignoring ', item['@_path']);
      }
    }

    // Sort teh playlists by name
    this._hqPlaylistItems.sort((a, b) => {
      const s1 = a['@_album'].toLowerCase();
      const s2 = b['@_album'].toLowerCase();
      if (s1 > s2) {
        return 1;
      } else if (s2 > s1) {
        return -1;
      } else {
        return 0;
      }
    });

    // Track hash is simply a representation of the track's filename.
    // Overwrite it with one that combines album hash + track hash!
    for (const album of this.albums) {
      const tracks = AlbumUtil.getTracksOf(album);
      for (const track of tracks) {
        track['@_hash'] = album['@_hash'] + '_' + track['@_hash'];
      }
    }

    this.initGenreArrays();
    this.initLabelArrays();

    // Init album lookup
    this.initTrackUriToTrackHash();

    this.initTrackYearValues();
  }

  /**
   * Creates new 'genres' property on the album objects, which is an array.
   * Also inits the `_genreNames` array.
   */
  initGenreArrays() {
    const names = {};
    for (const album of this._albums) {
      album['genres'] = [];
      const genreString = album['@_genre'];
      album['genres'] = AppUtil.splitGenreString(genreString);

      for (const genre of album['genres']) {
        names[genre] = '';
      }
    }
    this._genreNames = Object.keys(names).sort();
  }

  /**
   * Creates new 'labels' property on the album objects, which is an array.
   * Also inits the `_labelNames` array.
   */
  initLabelArrays() {
    const names = {};
    for (const album of this._albums) {
      album['labels'] = [];
      let labelValue = album['@_label'];
      if (labelValue) {
        if (Array.isArray(labelValue)) {
          labelValue = labelValue.filter(Boolean).join(', ');
        }
        if (typeof labelValue === 'string') {
          album['labels'] = AppUtil.splitGenreString(labelValue);
          for (const label of album['labels']) {
            names[label] = '';
          }
        }
      }
    }
    this._labelNames = Object.keys(names).sort();
  }

  initTrackUriToTrackHash() {
    this._trackUriToTrackHash = {};
    for (const album of this.albums) {
      const tracks = AlbumUtil.getTracksOf(album);
      for (const track of tracks) {
        const folder = Util.decodeXmlEntities(album['@_path'] || '').replace(/[\/\\]+$/, '');
        const filename = Util.decodeXmlEntities(track['@_name'] || '').replace(/^[\/\\]+/, '');
        const uri = (folder && filename) ? `${folder}/${filename}` : '';
        const encodedUri = Util.makeFileUriFromParts(album['@_path'], track['@_name']);
        const rawUri = 'file://' + album['@_path'] + '/' + track['@_name'];
        const comparablePath = Util.toComparableLocalPath(uri);
        const hash = track['@_hash'];
        if (uri) {
          this._trackUriToTrackHash[uri] = hash;
        }
        this._trackUriToTrackHash[encodedUri] = hash;
        this._trackUriToTrackHash[rawUri] = hash;
        if (comparablePath) {
          this._trackUriToTrackHash[comparablePath] = hash;
        }
      }
    }
  }

  initTrackHashLookup() {
    this._trackHashLookup = {};
    for (const album of this.albums) {
      const tracks = AlbumUtil.getTracksOf(album);
      for (const track of tracks) {
        const hash = track['@_hash'];
        this._trackHashLookup[hash] = [track, album];
      }
    }
  };

  /**
   * Adds `year` integer property to album objects, when possible.
   */
  initTrackYearValues() {
    for (const album of this.albums) {
      const date = album['@_date'];
      const year = AppUtil.getYearFromMetadataDate(date);
      if (year) {
        album['year'] = year;
      }
    }
  }
}
