import AlbumUtil from './album-util.js';
import AppUtil from './app-util.js';
import Commands from './commands.js';
import DataUtil from './data-util.js';
import LibraryAlbumOptionsView from './library-album-options-view.js';
import LibraryAlbumsList from './library-albums-list.js';
import LibraryContentList from './library-content-list.js';
import LibraryDataUtil from './library-data-util.js';
import LibraryGroupUtil from './library-group-util.js';
import SidebarView from './sidebar-view.js';
import MetaUtil from './meta-util.js';
import Model from './model.js';
import Service from './service.js';
import Settings from './settings.js';
import Subview from './subview.js';
import TrackListItemUtil from './track-list-item-util.js';
import TopBarUtil from './top-bar-util.js';
import Util from './util.js';
import Values from './values.js';
import ViewUtil from './view-util.js';

/**
 * Composite view containing two `LibraryContentList` subclasses.
 * Lives underneath any other main views.
 */
export default class LibraryView extends Subview {

  $title;
  $itemCount;
  $spinner;
  $scrollEl;

  albumOptionsView; // dropdowns + search button
  $searchButton;
  $searchCloseButton;

  albumsList;
  $searchList;
  $timelineView;
  trackMetaChangeHandler;
  _resultMode = 'albums';
  _resultCount = 0;

  constructor() {
    super($("#libraryView"));
    this.$scrollEl = this.$el.find('.library-main');
    // Library scrolls inside .library-main, so also bind scroll there for topbar collapse
    this.$scrollEl.on('scroll', () => TopBarUtil.onSubviewScroll(this.$scrollEl));
    this.$title = this.$el.find('#libraryTitle');
    this.$title.addClass('clickable');
    this.$title.on('click tap', () => (this.$scrollEl[0] || this.$el[0]).scrollTop = 0);
    this.$itemCount = this.$el.find('#libraryNumbers');
    this.$searchButton = this.$el.find('#librarySearchButton');
    this.$searchCloseButton = this.$el.find('#librarySearchCloseButton');
    this.$spinner = this.$el.find('#librarySpinner');
    this.$timelineView = this.$el.find('#timelineView');

    // Global search input in topbar
    this.$globalSearchInput = $('#globalSearchInput');
    this.$globalSearchClear = $('#globalSearchClear');

    this.albumOptionsView = new LibraryAlbumOptionsView(this.$el.find("#libraryAlbumOptionsView"));
    this.albumsList = new LibraryAlbumsList(this.$el.find('#libraryAlbumsList'));
    this.$searchList = this.$el.find('#librarySearchList');
    this.trackMetaChangeHandler = TrackListItemUtil.makeTrackMetaChangeHandler(this.$searchList);
    ViewUtil.setDisplayed(this.$searchList, false);

    this.$searchButton.on('click tap', () => this.openSearch());
    this.$searchCloseButton.on('click tap', () => this.closeSearch());

    // Global search configuration
    this._headerSearchMinLength = 2;
    this._headerSearchDebounceDelay = 300;

    // Global search input in topbar - filter albums as you type
    if (this.$globalSearchInput.length > 0) {
      this.$globalSearchInput.val('');
      this._globalSearchDebounceTimer = null;
      const updateGlobalSearchClearVisibility = () => {
        if (!this.$globalSearchClear || this.$globalSearchClear.length === 0) {
          return;
        }
        const value = this.$globalSearchInput.val().trim();
        this.$globalSearchClear.css('display', value.length > 0 ? 'flex' : 'none');
      };

      this.$globalSearchInput.on('input', (e) => {
        if (this._globalSearchDebounceTimer) {
          clearTimeout(this._globalSearchDebounceTimer);
        }

        const value = this.$globalSearchInput.val().trim();

        // Update clear button visibility
        updateGlobalSearchClearVisibility();

        if (value.length === 0) {
          this.clearHeaderSearchFilter();
          return;
        }

        if (value.length >= this._headerSearchMinLength) {
          this._globalSearchDebounceTimer = setTimeout(() => {
            this.applyHeaderSearchFilter(value);
          }, this._headerSearchDebounceDelay);
        }
      });

      this.$globalSearchInput.on('keyup', (e) => {
        if (e.keyCode === 13) {
          const value = this.$globalSearchInput.val().trim();
          $(document).trigger('global-search-enter', value);

          if (this._globalSearchDebounceTimer) {
            clearTimeout(this._globalSearchDebounceTimer);
            this._globalSearchDebounceTimer = null;
          }

          if (value.length === 0) {
            this.clearHeaderSearchFilter();
          } else if (value.length >= this._headerSearchMinLength) {
            this.applyHeaderSearchFilter(value);
          }
        }
      });

      if (this.$globalSearchClear) {
        this.$globalSearchClear.on('click', () => {
          this.$globalSearchInput.val('');
          updateGlobalSearchClearVisibility();
          this.clearHeaderSearchFilter();
          this.$globalSearchInput.focus();
        });
      }

      updateGlobalSearchClearVisibility();
    }
    Util.addAppListener(this, 'model-library-updated', this.onModelLibraryUpdated);
    Util.addAppListener(this, 'library-albums-filter-changed library-albums-list-populated',
      () => this.updateHeaderText(false));
    Util.addAppListener(this, 'library-albums-list-populated',
      () => this.syncExpandCollapseButtonState());
    Util.addAppListener(this, 'library-expand-all-groups', this.onExpandAllGroups);
    Util.addAppListener(this, 'library-collapse-all-groups', this.onCollapseAllGroups);
    Util.addAppListener(this, 'meta-load-result', this.onMetaLoadResult);
    Util.addAppListener(this, 'album-favorite-changed', this.onAlbumFavoriteChanged);
    Util.addAppListener(this, 'meta-track-favorite-changed', this.onTrackFavoriteChanged);
    $(document).on('meta-track-favorite-changed meta-track-incremented', this.trackMetaChangeHandler);
    this.$el.on('click tap', '.libraryNoneAction', this.onEmptyStateResetClick);

    // Listen for sidebar filter changes
    $(document).on('sidebar-filters-changed', (e, filterState) => {
      this.applySidebarFilters(filterState);
    });
  }

  setSpinnerState(b) {
    if (b) {
      this.$el.addClass('isDisabled');
      ViewUtil.setDisplayed(this.$spinner, true);
      this.$spinner.css('opacity', 1);
    } else {
      this.$el.removeClass('isDisabled');
      ViewUtil.setDisplayed(this.$spinner, false);
    }
  }

  showFirstTime() {
    this.setSpinnerState(false);
    ViewUtil.setVisible(this.albumsList.$el, true);

    this.albumsList.show();
    this.albumsList.update();
  }

  /**
   * Animates in search view state.
   */
  openSearch() {
    // Search is now handled by top header filter
  }

  /**
   * Shows search view state synchronously, with list populated.
   */
  openSearchSync(searchType, value) {
    // Search is now handled by top header filter
  }
  /**
   * Animates out search view state.
   */
  closeSearch() {
    // Search is now handled by top header filter
  }

  onModelLibraryUpdated() {
    this.albumsList.setAlbums(Model.library.albums);
    this.applyAllFilters();
  }

  onSearch(type, value) {
    // Search is now handled by top header filter
  }

  onExpandAllGroups() {
    this.albumsList.expandAllGroups();
  }

  onCollapseAllGroups() {
    this.albumsList.collapseAllGroups();
  }

  /**
   * Syncs the expand/collapse button state with the actual group states.
   */
  syncExpandCollapseButtonState() {
    const areAllCollapsed = this.albumsList.areAllLabelsCollapsed;

    if (areAllCollapsed === true) {
      // All groups are collapsed - button should show "expand" state (no isSelected)
      this.albumOptionsView.$expandCollapseButton.removeClass('isSelected');
      this.albumOptionsView.$expandCollapseButton.attr('title', 'Expand all');
    } else if (areAllCollapsed === false) {
      // At least one group is expanded - button should show "collapse" state (isSelected)
      this.albumOptionsView.$expandCollapseButton.addClass('isSelected');
      this.albumOptionsView.$expandCollapseButton.attr('title', 'Collapse all');
    }
    // If areAllCollapsed is null (no labels), do nothing
  }

  /** Returns true if handled/'eaten' */
  onEscape() {
    const scrollEl = (this.$scrollEl[0] || this.$el[0]);
    if (scrollEl.scrollTop > 0) {
      scrollEl.scrollTop = 0;
      return true;
    }
    return false;
  }

  updateHeaderText(isForSearch) {
    // isForSearch parameter is now ignored - search is done in-place
    this.updateResultHeader(this._resultMode, this._resultCount);
  }

  updateResultHeader(mode, count) {
    this._resultMode = mode;
    this._resultCount = count;
    this.$title.text('Library');
    const suffix = (mode === 'tracks')
      ? ((count == 1) ? ' track' : ' tracks')
      : ((count == 1) ? ' album' : ' albums');
    this.$itemCount.text(count + suffix);
    $('#albumCount').text(count);
  }

  makeFavoriteTracks(albums) {
    const result = [];
    for (const album of albums) {
      const tracks = AlbumUtil.getTracksOf(album);
      for (const track of tracks) {
        const hash = track['@_hash'];
        if (MetaUtil.isTrackFavoriteFor(hash)) {
          result.push(track);
        }
      }
    }
    return result;
  }

  showAlbumResults(filteredAlbums, emptyStateContext = null) {
    const isEmpty = filteredAlbums.length === 0;
    ViewUtil.setDisplayed(this.$timelineView, isEmpty ? 'flex' : true);
    $('#timelineMinimapContainer').removeClass('isVisible');
    $('#libraryView').removeClass('hasMinimap');
    ViewUtil.setDisplayed(this.albumsList.$el, true);
    ViewUtil.setDisplayed(this.$searchList, false);
    this.$timelineView.toggleClass('isEmptyState', isEmpty);
    this.$searchList.removeClass('isEmptyState');
    this.$scrollEl.toggleClass('hasCenteredEmptyState', isEmpty);

    this.albumsList.setEmptyStateContext(emptyStateContext);
    this.albumsList.albums = filteredAlbums;
    this.albumsList.filteredSortedAlbumsDirty = true;
    this.albumsList.groupsDirty = true;
    this.albumsList.domDirty = true;
    this.albumsList.setFilterType('none');
    this.albumsList.update();

    this.updateResultHeader('albums', filteredAlbums.length);
  }

  showTrackResults(tracks, emptyStateContext = null) {
    const isEmpty = tracks.length === 0;
    ViewUtil.setDisplayed(this.$timelineView, false);
    $('#timelineMinimapContainer').removeClass('isVisible');
    $('#libraryView').removeClass('hasMinimap');
    ViewUtil.setDisplayed(this.albumsList.$el, false);
    ViewUtil.setDisplayed(this.$searchList, isEmpty ? 'flex' : true);
    this.$scrollEl.toggleClass('hasCenteredEmptyState', isEmpty);
    this.$timelineView.removeClass('isEmptyState');

    this.$searchList.empty();
    this.$searchList.toggleClass('isEmptyState', isEmpty);
    if (tracks.length > 0) {
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const $item = $(this.makeFavoriteTrackListItem(i, track));
        const $coverImg = $item.find('.favoriteTrackCoverImg');
        if ($coverImg.length > 0) {
          $coverImg.on('error', () => {
            $item.find('.favoriteTrackCover').addClass('isCoverMissing');
          });
          $coverImg.on('load', () => {
            $item.find('.favoriteTrackCover').removeClass('isCoverMissing');
          });
        }
        $item.find('.favoriteButton').on('click tap', (e) => TrackListItemUtil.onFavoriteButtonClick(e));
        $item.find('.playButton').on('click tap', (e) => this.onFavoriteTrackPlayClick(e));
        this.$searchList.append($item);
      }
    } else {
      this.$searchList.append(LibraryContentList.makeListIsEmptyItem(emptyStateContext));
    }

    this.updateResultHeader('tracks', tracks.length);
  }

  makeFavoriteTrackListItem(index, track) {
    const seconds = parseInt(track['@_length']);
    const durationText = seconds ? Util.durationText(seconds) : '';
    const durationEmptyClass = durationText ? '' : 'isEmpty';
    const song = track['@_song'] || 'Track';
    const hash = track['@_hash'] || '';
    const album = Model.library.getAlbumByTrackHash(hash);
    const coverUrl = album ? DataUtil.getAlbumImageUrl(album) : '';
    const coverMissingClass = coverUrl ? '' : 'isCoverMissing';
    const isFavorite = MetaUtil.isTrackFavoriteFor(hash);
    const favoriteSelectedClass = isFavorite ? 'isSelected' : '';
    const numViews = MetaUtil.getNumViewsFor(hash);

    let extra = '';
    if (track['@_performer']) {
      extra += `<div class='extraLine'><span class='caption'>Performer</span> <span class='extraValue'>${track['@_performer']}</span></div>`;
    }
    if (track['@_artist']) {
      extra += `<div class='extraLine'><span class='caption'>Artist</span> <span class='extraValue'>${track['@_artist']}</span></div>`;
    }
    if (track['@_composer']) {
      extra += `<div class='extraLine'><span class='caption'>Composer</span> <span class='extraValue'>${track['@_composer']}</span></div>`;
    }

    let s = '';
    s += `<div class="albumItem" data-index="${index}" data-hash="${hash}">`;
    s += `  <div class="albumItemLeft">`;
    s += `    <div class="playButton iconPlay" data-index="${index}" title="Play Track Now"></div>`;
    s += `    <span class="indexText">${index + 1}</span>`;
    s += `  </div>`;
    s += `  <div class="favoriteTrackCover ${coverMissingClass}">`;
    if (coverUrl) {
      s += `    <img class="favoriteTrackCoverImg" src="${coverUrl}" alt="">`;
    }
    s += `    <div class="favoriteTrackCoverFallback" aria-hidden="true"></div>`;
    s += `  </div>`;
    s += `  <div class="albumItemMain">`;
    s += `    <div class="song">${song}</div>`;
    if (extra) {
      s += `  <div class="extra">${extra}</div>`;
    }
    s += `  </div>`;
    s += `  <div class="albumItemDurationCol ${durationEmptyClass}"><span class="albumItemDuration">${durationText}</span></div>`;
    s += `  <div class="trackItemMeta">`;
    s += `    <div class="numViews">${numViews || ''}</div>`;
    s += `    <div class="iconButton toggleButton favoriteButton ${favoriteSelectedClass}">`;
    s += `      <div class="favoriteIcon"></div>`;
    s += `    </div>`;
    s += `  </div>`;
    s += `</div>`;
    return s;
  }

  onFavoriteTrackPlayClick(event) {
    event.stopPropagation();
    const index = parseInt($(event.currentTarget).attr('data-index'));
    if (!(index >= 0)) {
      return;
    }

    const tracks = this.$searchList.find('.albumItem');
    if (!tracks || index >= tracks.length) {
      return;
    }

    const hash = $(tracks[index]).attr('data-hash');
    if (!hash) {
      return;
    }

    const album = Model.library.getAlbumByTrackHash(hash);
    if (!album) {
      return;
    }

    const albumTracks = AlbumUtil.getTracksOf(album);
    const trackIndex = albumTracks.findIndex(t => t['@_hash'] === hash);
    if (!(trackIndex >= 0)) {
      return;
    }

    const endIndex = albumTracks.length > 0 ? albumTracks.length - 1 : trackIndex;
    const commands = Commands.playlistAddUsingAlbumAndIndices(album, trackIndex, endIndex, true);
    AppUtil.doPlaylistAdds(commands, true, true);
  }

  /**
   * Unifies and applies all current filters (sidebar + header search).
   */
  applyAllFilters() {
    // Get all albums
    let allAlbums = Model.library.albums;
    if (!allAlbums) {
      return;
    }

    const { formats, genres, periods, browse } = SidebarView.getFilterState();

    // Get search value from either input (they should be synced)
    let searchValue = '';
    if (this.$globalSearchInput && this.$globalSearchInput.length > 0 && this.$globalSearchInput.val().trim()) {
      searchValue = this.$globalSearchInput.val().trim();
    } else if (this.$headerSearchInput && this.$headerSearchInput.length > 0) {
      searchValue = this.$headerSearchInput.val().trim();
    }

    // Split search input by comma for AND search
    // "pink floyd, 1970, dsd" -> ["pink floyd", "1970", "dsd"]
    const searchTerms = searchValue.split(/,\s*/).map(s => {
      const term = s.trim();
      return term.length > 0 ? term.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
    }).filter(s => s.length > 0);

    const hasSidebarFilters = (formats && formats.length > 0)
      || (genres && genres.length > 0)
      || (periods && periods.length > 0)
      || browse !== 'all-albums';
    const hasSearchFilter = searchTerms.length > 0;
    const emptyStateContext = {
      hasSidebarFilters,
      hasSearchFilter
    };

    // Apply filters
    let filteredAlbums = allAlbums.filter(album => {
      // 1. Sidebar: Browse filter
      if (browse === 'favorite-albums') {
        const albumHash = album['@_hash'];
        if (!MetaUtil.isAlbumFavoriteFor(albumHash)) {
          return false;
        }
      } else if (browse === 'favorite-tracks') {
        // Check if album has any favorite tracks
        const tracks = AlbumUtil.getTracksOf(album);
        const hasFavoriteTrack = tracks.some(t => {
          const trackHash = t['@_hash'];
          return MetaUtil.isTrackFavoriteFor(trackHash);
        });
        if (!hasFavoriteTrack) return false;
      }

      // 2. Sidebar: Format filter (OR logic)
      if (formats && formats.length > 0) {
        const albumFormat = this.getAlbumFormatKey(album);
        if (!albumFormat || !formats.includes(albumFormat)) {
          return false;
        }
      }

      // 3. Sidebar: Genre filter (OR logic)
      if (genres && genres.length > 0) {
        const albumGenre = album['@_genre'];
        if (!albumGenre || !genres.includes(albumGenre)) {
          return false;
        }
      }

      // 4. Sidebar: Period filter (OR logic)
      if (periods && periods.length > 0) {
        const albumYear = parseInt(album['year'] || album['@_year']);
        let inPeriod = false;
        if (!isNaN(albumYear)) {
          for (const period of periods) {
            if (albumYear >= period.start && albumYear <= period.end) {
              inPeriod = true;
              break;
            }
          }
        }
        if (!inPeriod) {
          return false;
        }
      }

      // 5. Header Search Filter (AND logic)
      if (searchTerms.length > 0) {
        // For each search term, check if album matches
        // ALL terms must match for the album to be included
        const matchesAllSearchTerms = searchTerms.every(searchVal => this.albumMatchesSearchTerm(album, searchVal));
        if (!matchesAllSearchTerms) {
          return false;
        }
      }

      return true;
    });

    if (browse === 'favorite-tracks') {
      const tracks = this.makeFavoriteTracks(filteredAlbums);
      this.showTrackResults(tracks, emptyStateContext);
    } else {
      this.showAlbumResults(filteredAlbums, emptyStateContext);
    }
  }

  /**
   * Apply sidebar filters to albums list.
   */
  applySidebarFilters(filterState) {
    this.applyAllFilters();
  }

  onAlbumFavoriteChanged = () => {
    const { browse } = SidebarView.getFilterState();
    if (browse === 'favorite-albums') {
      this.applyAllFilters();
    }
  }

  onTrackFavoriteChanged = () => {
    const { browse } = SidebarView.getFilterState();
    if (browse === 'favorite-tracks') {
      this.applyAllFilters();
    }
  }

  onMetaLoadResult = () => {
    if (!Model.library || !Model.library.albums) {
      return;
    }
    this.applyAllFilters();
  }

  /**
   * Get format key for album based on sample rate and bits.
 */
  getAlbumFormatKey(album) {
    const rateHz = parseInt(album['@_rate']) || 0;
    const bits = parseInt(album['@_bits']) || 0;

    // DSD
    if (bits === 1 && rateHz > 0) {
      const dsdRate = rateHz / 1000000; // Convert Hz to MHz
      const dsdMultiple = Math.round(dsdRate / 2.8);
      if (dsdMultiple >= 1) {
        return 'DSD' + (dsdMultiple * 64);
      }
      return 'DSD';
    }

    // PCM
    const rateKHz = Math.round(rateHz / 1000);
    switch (rateKHz) {
      case 44: return 'PCM44';
      case 48: return 'PCM48';
      case 88: return 'PCM88';
      case 96: return 'PCM96';
      case 176: return 'PCM176';
      case 192: return 'PCM192';
      case 352: return 'PCM352';
      case 384: return 'PCM384';
      default: return rateKHz ? 'PCM' + rateKHz : null;
    }
  }


  /**
   * Parse year search string into array of year matches.
   * Supports: "1970", "1970-1980", "1990-", "-2000", "1970,1975,1980"
   * Returns array of: integers (exact years) or [start, end] arrays (ranges)
   */
  parseYearSearch(string) {
    if (!string) {
      return [];
    }

    const result = [];
    const tokens = string.split(/[,;/ ]/); // comma semicolon space

    for (const token of tokens) {
      // Check for range with dash: "1970-1980", "1990-", "-2000"
      if (token.includes('-')) {
        const parts = token.split('-');

        if (parts.length === 2) {
          const startYear = parts[0] ? AppUtil.getValidYear(parts[0]) : null;
          const endYear = parts[1] ? AppUtil.getValidYear(parts[1]) : null;

          // "1970-1980" - both years specified
          if (startYear && endYear && endYear >= startYear) {
            result.push([startYear, endYear]);
          }
          // "1990-" - from year to present
          else if (startYear && !endYear) {
            result.push([startYear, 2099]); // 2099 is max valid year
          }
          // "-2000" - from beginning to year
          else if (!startYear && endYear) {
            result.push([1500, endYear]); // 1500 is min valid year
          }
        }
      } else {
        // Single year
        const year = AppUtil.getValidYear(token);
        if (year) {
          result.push(year);
        }
      }
    }

    return result;
  }

  /**
   * Check if album year matches any of the year search criteria.
   * @param albumYear - the year of the album (integer)
   * @param yearArray - array from parseYearSearch
   */
  isYearMatch(albumYear, yearArray) {
    if (!yearArray || yearArray.length === 0) {
      return false;
    }

    const year = AppUtil.getValidYear(albumYear);
    if (!year) {
      return false;
    }

    for (const item of yearArray) {
      if (Array.isArray(item)) {
        // Range: [start, end]
        if (year >= item[0] && year <= item[1]) {
          return true;
        }
      } else {
        // Single year
        if (year === item) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a single album matches a single search term.
   * Used by AND search logic in applyHeaderSearchFilter.
   */
  albumMatchesSearchTerm(album, searchValue) {
    // Helper function to normalize text for diacritic-insensitive comparison
    const normalizeText = (text) => {
      return text ? text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
    };

    // Check album-level fields
    const artist = normalizeText(album['@_artist']);
    const albumName = normalizeText(album['@_album']);
    const genre = normalizeText(album['@_genre']);

    if (artist.includes(searchValue) ||
      albumName.includes(searchValue) ||
      genre.includes(searchValue)) {
      return true;
    }

    // Check year with range support
    const yearArray = this.parseYearSearch(searchValue);
    const isYearSearch = yearArray.length > 0;

    const albumYear = album['year'];
    if (isYearSearch && albumYear && this.isYearMatch(albumYear, yearArray)) {
      return true;
    }

    // Also check raw year field for simple year searches
    const yearRaw = album['@_year'] ? album['@_year'].toLowerCase() : '';
    if (!isYearSearch && yearRaw && yearRaw.includes(searchValue)) {
      return true;
    }

    // Check sample rate formats
    const rateHz = parseInt(album['@_rate']) || 0;
    const bits = parseInt(album['@_bits']) || 0;
    const isDsd = bits === 1;

    if (rateHz > 0) {
      const rateKHz = rateHz / 1000;
      const sampleRateFormats = [
        String(rateHz),           // "44100"
        rateHz + 'hz',            // "44100hz"
        rateHz + ' hz',           // "44100 hz"
        String(rateKHz),          // "44.1"
        rateKHz + 'khz',          // "44.1khz"
        rateKHz + ' khz'          // "44.1 khz"
      ];
      // Add integer kHz for whole numbers like 48, 96, 192
      if (rateKHz === Math.floor(rateKHz)) {
        sampleRateFormats.push(String(Math.floor(rateKHz)));
      }

      if (sampleRateFormats.some(fmt => fmt.includes(searchValue))) {
        return true;
      }
    }

    // Check DSD formats
    if (isDsd && rateHz > 0) {
      const dsdRate = rateHz / 1000000; // Convert Hz to MHz for DSD
      const dsdFormats = ['dsd', dsdRate + 'mhz', dsdRate + ' mhz'];
      const dsdMultiple = Math.round(dsdRate / 2.8);
      if (dsdMultiple >= 1) {
        dsdFormats.push('dsd' + (dsdMultiple * 64));
        dsdFormats.push('dsd ' + (dsdMultiple * 64));
      }

      if (dsdFormats.some(fmt => fmt.includes(searchValue))) {
        return true;
      }
    }

    // Check track-level fields
    const tracks = AlbumUtil.getTracksOf(album);
    for (const track of tracks) {
      const song = normalizeText(track['@_song']);
      if (song.includes(searchValue)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Apply header search filter to albums list.
   */
  applyHeaderSearchFilter(searchValue) {
    this.applyAllFilters();
  }

  /**
   * Clear header search filter and show all albums.
   */
  clearHeaderSearchFilter() {
    this.applyAllFilters();
  }

  onEmptyStateResetClick = (event) => {
    event.preventDefault();
    event.stopPropagation();

    const action = $(event.currentTarget).attr('data-action');

    if (this._globalSearchDebounceTimer) {
      clearTimeout(this._globalSearchDebounceTimer);
      this._globalSearchDebounceTimer = null;
    }

    if (action === 'clear-filters') {
      SidebarView.resetFilters();
      return;
    }

    if (this.$globalSearchInput && this.$globalSearchInput.length > 0) {
      this.$globalSearchInput.val('');
    }
    if (this.$globalSearchClear && this.$globalSearchClear.length > 0) {
      this.$globalSearchClear.css('display', 'none');
    }
    this.clearHeaderSearchFilter();
  }
}
