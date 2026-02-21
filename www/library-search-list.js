import AlbumUtil from './album-util.js';
import LibraryContentList from './library-content-list.js';
import LibraryDataUtil from './library-data-util.js';
import DataUtil from './data-util.js';
import MetaUtil from './meta-util.js';
import Model from './model.js';
import Settings from './settings.js';
import LibraryGroupUtil from './library-group-util.js';
import TrackListItemContextMenu from './track-list-item-context-menu.js';
import TrackListItemUtil from './track-list-item-util.js';
import ViewUtil from './view-util.js';
import Util from './util.js';

/**
 * One of the two main library 'content views'.
 * Shows search results using artist name, album name, or tracks name (mutually exclusive).
 * Track results use own list item type (similar to history view).
 */
export default class LibrarySearchList extends LibraryContentList {

  searchType;
  searchValue;
  trackMetaChangeHandler;

  constructor($el) {
    super($el);
    ViewUtil.setDisplayed(this.$el, false);

    this.trackMetaChangeHandler = TrackListItemUtil.makeTrackMetaChangeHandler(this.$el);
    $(document).on('meta-track-favorite-changed meta-track-incremented', this.trackMetaChangeHandler);

    this.sortType = 'default';
  }

  // override
  show(now) {
    // Hide timeline view when search is shown to avoid empty block
    $('#timelineView').css('display', 'none');
    ViewUtil.setDisplayed(this.$el, true);
    if (now) {
      ViewUtil.setCssSync(this.$el, () => this.$el.css('opacity', 1));
    } else {
      ViewUtil.animateCss(this.$el,
          () => this.$el.css('opacity', 0),
          () => this.$el.css('opacity', 1),
          null);
    }
  }

  // override
  hide(callback) {
    if (!ViewUtil.isDisplayed(this.$el)) {
      this.clear();
      if (callback) {
        callback();
      }
      return;
    }
    ViewUtil.animateCss(this.$el,
        () => this.$el.css('opacity', 1),
        () => this.$el.css('opacity', 0),
        () => {
          ViewUtil.setDisplayed(this.$el, false);
          // Show timeline view again when search is hidden
          $('#timelineView').css('display', 'block');
          this.clear();
          if (callback) {
            callback();
          }
        });
  }


  // override
  setAlbums(albums) {
    this.albums = [...albums];
    // For search results, we are only ever ordering items by artist/album
    this.albums.sort(LibraryDataUtil.sortByArtistThenAlbum);
  }

  /**
   * Data + dom only ever get generated thru here
   */
  setSearchTypeAndValue(type, value='') {
    this.searchType = type;
    this.searchValue = value.toLowerCase();
    Settings.librarySearchType = type;
    Settings.librarySearchValue = value || '';
    this.makeGroups();
    this.populateDom();
    this.$el.parent()[0].scrollTop = 0;
    $(document).trigger('library-search-view-populated');
  }

  getSearchType() {
    return this.searchType;
  }

  makeGroups() {
    let o;
    switch (this.searchType) {
      case 'all':
        o = this.makeAllMetadataGroup();
        break;
      case 'artist':
        o = this.makeArtistGroups();
        break;
      case 'album':
        o = this.makeAlbumsGroup();
        break;
      case 'genre':
        o = this.makeGenreGroups();
        break;
      case 'year':
        o = this.makeYearGroups();
        break;
      case 'track':
        o = this.makeTracksGroup();
        break;
      case 'albumFavorites':
        o = this.makeAlbumFavoritesGroup();
        break;
      case 'trackFavorites':
        o = this.makeTrackFavoritesGroup();
        break;
      default:
        cl('warning logic');
        break;
    }
    if (!o || !o['labels'] || !o['groups']) {
      o = {labels: [], groups: []};
    }
    this.labels = o['labels'];
    this.groups = o['groups'];
  }

  // override
  get groupCssClass() {
    return (this.searchType == 'track' || this.searchType == 'trackFavorites')
        ? 'libraryTrackGroup' : 'libraryAlbumGroup';
  }

  // override
  get labelCssClass() {
    return (this.searchType == 'all') ? 'all' : this.searchType;
  }

  // override
  populateGroupDiv($group, array) {
    if (this.searchType == 'all') {
      this.populateAllMetadataGroupDiv($group, array);
    } else if (this.searchType == 'track' || this.searchType == 'trackFavorites') {
      this.populateTrackGroupDiv($group, array);
    } else {
      super.populateGroupDiv($group, array);
    }
  }

  populateAllMetadataGroupDiv($group, array) {
    const items$ = [];
    for (let i = 0; i < array.length; i++) {
      const matchInfo = array[i];
      const $item = this.makeAllMetadataListItem(matchInfo, i);
      $group.append($item);
      items$.push($item);
    }
    for (const $item of items$) {
      // Album click handlers
      $item.find(".clickableAlbum").on("click tap", e => this.onAllMetadataAlbumClick(e));
      
      // More button handler
      const $moreButton = $item.find(".contextButton");
      if ($moreButton.length > 0) {
        $moreButton.on("click tap", this.onAllMetadataContextButton);
      }
      
      // Observe images for lazy loading
      const img = $item.find('img')[0];
      if (img) {
        this.intersectionObs.observe(img);
      }
    }
  }

  // override
  makeListItem(data, index) {
    switch (this.searchType) {
      case 'artist':
      case 'album':
      case 'genre':
      case 'year':
      case 'albumFavorites':
        return LibraryContentList.makeAlbumListItem(data);
        break;
      case 'track':
      case 'trackFavorites':
        return this.makeTrackListItem(data, index);
        break;
    }
    cl('warning logic');
    return null;
  }

  getItemCount() {
    if (!this.groups) {
      return 0;
    }
    let count = 0;
    for (const group of this.groups) {
      count += group.length;
    }
    return count;
  }

  /**
   * Returns groups of albums matching search in any metadata field
   * (artist, album title, genre, year, or track name).
   */
  makeAllMetadataGroup() {
    if (!this.searchValue) {
      return { labels: [], groups: []}
    }
    const matchingItems = [];

    for (const album of this.albums) {
      let matchInfo = {
        album: album,
        matchedTracks: [],
        matchedField: null  // 'artist', 'album', 'genre', 'year', or 'track'
      };

      // Check album-level fields
      const artist = album['@_artist'] ? album['@_artist'].toLowerCase() : '';
      const albumName = album['@_album'] ? album['@_album'].toLowerCase() : '';
      const genre = album['@_genre'] ? album['@_genre'].toLowerCase() : '';
      const year = album['@_year'] ? album['@_year'].toLowerCase() : '';

      if (artist.includes(this.searchValue)) {
        matchInfo.matchedField = 'artist';
      } else if (albumName.includes(this.searchValue)) {
        matchInfo.matchedField = 'album';
      } else if (genre.includes(this.searchValue)) {
        matchInfo.matchedField = 'genre';
      } else if (year.includes(this.searchValue)) {
        matchInfo.matchedField = 'year';
      }

      // Check track-level fields
      const tracks = AlbumUtil.getTracksOf(album);
      for (const track of tracks) {
        const song = track['@_song'] ? track['@_song'].toLowerCase() : '';
        if (song.includes(this.searchValue)) {
          matchInfo.matchedTracks.push(track);
          if (!matchInfo.matchedField) {
            matchInfo.matchedField = 'track';
          }
        }
      }

      // If matched in any field, add to results
      if (matchInfo.matchedField || matchInfo.matchedTracks.length > 0) {
        matchingItems.push(matchInfo);
        if (matchingItems.length >= 500) {
          break;
        }
      }
    }

    const labels = [];
    const groups = [];
    const group = matchingItems;
    groups.push(group);
    labels.push('');

    return { labels: labels, groups: groups };
  }

  /**
   * Returns groups of albums of artists
   * whose names include the search term.
   */
  makeArtistGroups() {
    if (!this.searchValue) {
      return { labels: [], groups: []}
    }
    const artists = {};
    for (const album of this.albums) {
      const artist = album['@_artist'].toLowerCase();
      if (artist && artist.includes(this.searchValue)) {
        if (!artists[artist]) {
          artists[artist] = [];
        }
        artists[artist].push(album);
      }
    }
    const labels = [];
    const groups = [];
    let keys = Object.keys(artists);
    keys.sort();
    for (const key of keys) {
      const group = artists[key];
      groups.push(group);

      // We lowercase'd the key earlier, so get 'original' version
      let label = group[0]['@_artist'] || key;
      labels.push(label);
    }
    return { labels: labels, groups: groups}
  }

  makeGenreGroups() {
    if (!this.searchValue) {
      return { labels: [], groups: [] }
    }
    return LibraryGroupUtil.makeGenreGroups(this.albums, this.searchValue);
  }

  makeYearGroups() {
    if (!this.searchValue) {
      return { labels: [], groups: [] }
    }
    return LibraryGroupUtil.makeYearGroups(this.albums, this.searchValue);
  }

  /**
   * Returns array of one group
   * whose album names include the search term.
   */
  makeAlbumsGroup() {
    if (!this.searchValue) {
      return { labels: [], groups: []}
    }
    const group = [];
    for (const album of this.albums) {
      const name = album['@_album'];
      if (name && name.toLowerCase().includes(this.searchValue)) {
        group.push(album);
      }
    }
    return { labels: [], groups: [group] };
  }

  /**
   * Returns list of tracks whose names include the search term.
   * Basically.
   */
  makeTracksGroup() {
    if (!this.searchValue) {
      return { labels: [], groups: []}
    }
    const group = [];
    for (const album of this.albums) {
      const tracks = AlbumUtil.getTracksOf(album);
      for (const track of tracks) {
        const song = track['@_song'];
        if (song && song.toLowerCase().includes(this.searchValue)) {
          // note special format in this case
          const o = { track: track, album: album };
          group.push(o);
        }
        if (group.length >= 500) {
          return { labels: [], groups: [group] };
        }
      }
    }
    return { labels: [], groups: [group] };
  }

  /**
   * Returns array of one group whose albums are favorited.
   */
  makeAlbumFavoritesGroup() {
    const group = [];
    for (const album of this.albums) {
      const hash = album['@_hash'];
      if (MetaUtil.isAlbumFavoriteFor(hash)) {
        group.push(album);
        if (group.length >= 500) {
          return { labels: [], groups: [group] };
        }
      }
    }
    return { labels: [], groups: [group] };
  }

  /**
   * Returns list of favorited tracks.
   */
  makeTrackFavoritesGroup() {
    const group = [];
    for (const album of this.albums) {
      const tracks = AlbumUtil.getTracksOf(album);
      for (const track of tracks) {
        const hash = track['@_hash'];
        if (MetaUtil.isTrackFavoriteFor(hash)) {
          // note special format in this case
          const o = { track: track, album: album };
          group.push(o);
        }
        if (group.length >= 500) {
          return { labels: [], groups: [group] };
        }
      }
    }
    return { labels: [], groups: [group] };
  }

  populateTrackGroupDiv($group, array) {
    const a = array.map(item => item['track']);
    const items$ = TrackListItemUtil.populateList($group, a);

    for (const $item of items$) {
      $item.find(".contextButton").on("click tap", this.onTrackListItemContextButton);
    }
  }

  makeAllMetadataListItem(matchInfo, index) {
    const album = matchInfo['album'];
    const hash = album['@_hash'];
    const imgPath = DataUtil.getAlbumImageUrl(album);
    const artist = album['@_artist'] || '';
    const albumText = album['@_album'] || '';
    const matchedField = matchInfo['matchedField'];
    const matchedTracks = matchInfo['matchedTracks'] || [];
    const isFavoriteClass = MetaUtil.isAlbumFavoriteFor(hash) ? 'isFavorite' : '';

    let s = '';
    s += `<div class="libraryAllMetadataItem ${isFavoriteClass}" data-hash="${hash}" data-index="${index}">`;
    s += `  <div class="itemPicture clickableAlbum"><img data-src="${imgPath}" /></div>`;
    s += `  <div class="itemInfo clickableAlbum">`;
    s += `    <div class="artistAlbum">`;
    s += `      <div class="artist">${artist}</div>`;
    s += `      <div class="album">${albumText}</div>`;
    s += `    </div>`;
    
    // If matched in track(s), show them with highlighting and track numbers from album
    if (matchedTracks.length > 0) {
      s += `    <div class="tracksContainer">`;
      
      // Get all tracks from album to find real track numbers
      const allAlbumTracks = AlbumUtil.getTracksOf(album);
      
      for (const track of matchedTracks) {
        // Find the real track number in the album
        let realTrackNumber = 0;
        for (let i = 0; i < allAlbumTracks.length; i++) {
          if (allAlbumTracks[i]['@_hash'] === track['@_hash']) {
            realTrackNumber = i + 1;
            break;
          }
        }
        
        const songName = track['@_song'] || '';
        const highlightedSong = this.highlightSearchTerm(songName);
        s += `      <div class="matchedTrack">${realTrackNumber}. ${highlightedSong}</div>`;
      }
      s += `    </div>`;
    } else {
      // Show which field matched (artist, album, genre, or year) with highlighting
      let fieldText = '';
      switch (matchedField) {
        case 'artist':
          fieldText = `Artist: ${this.highlightSearchTerm(artist)}`;
          break;
        case 'album':
          fieldText = `Album: ${this.highlightSearchTerm(albumText)}`;
          break;
        case 'genre':
          const genre = album['@_genre'] || '';
          fieldText = `Genre: ${this.highlightSearchTerm(genre)}`;
          break;
        case 'year':
          const year = album['@_year'] || '';
          fieldText = `Year: ${this.highlightSearchTerm(year)}`;
          break;
      }
      if (fieldText) {
        s += `    <div class="matchedField">${fieldText}</div>`;
      }
    }
    
    s += `  </div>`;
    s += `  <div class="itemMeta">`;
    s += `    <div class="iconButton toggleButton favoriteButton" data-index="${index}"></div>`;
    s += `    <div class="iconButton moreButton contextButton" data-index="${index}"></div>`;
    s += `  </div>`;
    s += `</div>`;

    const $item = $(s);
    return $item;
  }

  highlightSearchTerm(text) {
    if (!text || !this.searchValue) {
      return text;
    }
    const regex = new RegExp(`(${this.searchValue})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
  }

  //(index, item, itemPrevious, itemNext, hasAlbum) {
  // todo is this used?
  makeTrackListItem(data, index) {
    const track = data['track'];
    const album = data['album'];
    const artistDiv = album['@_artist'] ? `<div class="artist">${album['@_artist']}</div>` : '';
    const albumDiv = album['@_album'] ? `<div class="album">${album['@_album']}</div>` : '';
    const favoriteSelectedClass = 'isFavorite'; // temp
    let s = '';
    s += `<div class="libraryTrackItem">`;
    s += `  <div class="content">`;
    s += `    <div class="song">${track['@_song'] || ''}</div>`;
    s +=      artistDiv;
    s +=      albumDiv;
    s += `  </div>`;
    s += `  <div class="trackItemMeta">`;
    s += `    <div class="numViews">${999 || ''}</div>`;
    s += `    <div class="iconButton toggleButton favoriteButton ${favoriteSelectedClass}" data-index="${index}"></div>`;
    s += `  </div>`;
    s += `  <div class="iconButton moreButton" data-index="${index}"></div>`;
    s += `</div>`;
    const $item = $(s);
    $item.find('.moreButton').on('click tap', this.onTrackListItemContextButton);
    return $item;
  }

  // override
  onItemClick(e) {
    if (this.searchType == 'track') {
      // track list items aren't clickable (only their more buttons)
      return;
    }
    super.onItemClick(e)
  }

  onTrackListItemContextButton = (e) => {
    event.stopPropagation();
    const $button = $(e.currentTarget);
    const $listItem = $button.parent().parent();
    const index = $listItem.attr('data-index');
    if (!(index >= 0)) {
      return;
    }
    if (!this.groups || !this.groups[0]) {
      return;
    }
    const o = this.groups[0][index];
    if (!o || !o['track'] || !o['album']) {
      return;
    }
    TrackListItemContextMenu.show($('#libraryView'), $button, o);
  };

  onAllMetadataContextButton = (e) => {
    event.stopPropagation();
    const $button = $(e.currentTarget);
    const $listItem = $button.closest('.libraryAllMetadataItem');
    const index = $listItem.attr('data-index');
    if (!(index >= 0)) {
      return;
    }
    if (!this.groups || !this.groups[0]) {
      return;
    }
    const matchInfo = this.groups[0][index];
    if (!matchInfo || !matchInfo['album']) {
      return;
    }
    
    // If there are matched tracks, show context menu for the album with track selection
    // Otherwise show context menu for just the album
    const album = matchInfo['album'];
    const o = { album: album, track: null };
    
    if (matchInfo['matchedTracks'] && matchInfo['matchedTracks'].length > 0) {
      // For track matches, use the first matched track for context menu
      o['track'] = matchInfo['matchedTracks'][0];
    }
    
    TrackListItemContextMenu.show($('#libraryView'), $button, o);
  };

  onAllMetadataAlbumClick = (e) => {
    e.stopPropagation();
    const $listItem = $(e.currentTarget).closest('.libraryAllMetadataItem');
    const hash = $listItem.attr('data-hash');
    const album = Model.library.getAlbumByAlbumHash(hash);
    $(document).trigger('library-item-click', [album, $listItem]);
  };
}