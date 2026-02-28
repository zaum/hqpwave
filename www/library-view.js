import AlbumUtil from './album-util.js';
import AppUtil from './app-util.js';
import DataUtil from './data-util.js';
import LibraryAlbumOptionsView from './library-album-options-view.js';
import LibraryAlbumsList from './library-albums-list.js';
import LibraryDataUtil from './library-data-util.js';
import LibraryGroupUtil from './library-group-util.js';
import SidebarView from './sidebar-view.js';
import Model from './model.js';
import Service from './service.js';
import Settings from './settings.js';
import Subview from './subview.js';
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

  constructor() {
    super($("#libraryView"));
    this.$scrollEl = this.$el.find('.library-main');
    this.$title = this.$el.find('#libraryTitle');
    this.$title.addClass('clickable');
    this.$title.on('click tap', () => (this.$scrollEl[0] || this.$el[0]).scrollTop = 0);
    this.$itemCount = this.$el.find('#libraryNumbers');
    this.$searchButton = this.$el.find('#librarySearchButton');
    this.$searchCloseButton = this.$el.find('#librarySearchCloseButton');
    this.$spinner = this.$el.find('#librarySpinner');

    // Global search input in topbar
    this.$globalSearchInput = $('#globalSearchInput');
    this.$globalSearchClear = $('#globalSearchClear');

    this.albumOptionsView = new LibraryAlbumOptionsView(this.$el.find("#libraryAlbumOptionsView"));
    this.albumsList = new LibraryAlbumsList(this.$el.find('#libraryAlbumsList'));

    this.$searchButton.on('click tap', () => this.openSearch());
    this.$searchCloseButton.on('click tap', () => this.closeSearch());

    // Global search configuration
    this._headerSearchMinLength = 2;
    this._headerSearchDebounceDelay = 300;

    // Global search input in topbar - filter albums as you type
    if (this.$globalSearchInput.length > 0) {
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
    Util.addAppListener(this, 'album-favorite-changed', this.onAlbumFavoriteChanged);
    Util.addAppListener(this, 'meta-track-favorite-changed', this.onTrackFavoriteChanged);

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
    this.$title.text('Library');
    const count = this.albumsList.filteredSortedAlbums.length;
    const suffix = (count == 1) ? ' album' : ' albums';
    this.$itemCount.text(count + suffix);
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

    // Apply filters
    let filteredAlbums = allAlbums.filter(album => {
      // 1. Sidebar: Browse filter
      if (browse === 'favorite-albums') {
        const albumHash = album['@_hash'];
        if (!window.hqpwv || !window.hqpwv.MetaUtil || !window.hqpwv.MetaUtil.isAlbumFavoriteFor(albumHash)) {
          return false;
        }
      } else if (browse === 'favorite-tracks') {
        // Check if album has any favorite tracks
        const tracks = album.track || [];
        const hasFavoriteTrack = tracks.some(t => {
          const trackHash = t['@_hash'];
          return window.hqpwv && window.hqpwv.MetaUtil && window.hqpwv.MetaUtil.isTrackFavoriteFor(trackHash);
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

    // Make sure albums list is visible
    ViewUtil.setDisplayed(this.albumsList.$el, true);

    // Set filtered albums to albums list and force dirty flags to rebuild
    this.albumsList.albums = filteredAlbums;
    this.albumsList.filteredSortedAlbumsDirty = true;
    this.albumsList.groupsDirty = true;
    this.albumsList.domDirty = true;
    this.albumsList.setFilterType('none');
    this.albumsList.update();

    // Update header to show filtered count
    this.$title.text('Library');
    const count = filteredAlbums.length;
    const suffix = (count == 1) ? ' album' : ' albums';
    this.$itemCount.text(count + suffix);

    // Update album count in toolbar
    $('#albumCount').text(count);
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
    // Split search input by comma for AND search
    // "pink floyd, 1970, dsd" -> ["pink floyd", "1970", "dsd"]
    const searchTerms = searchValue.split(/,\s*/).map(s => {
      const term = s.trim();
      return term.length > 0 ? term.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
    }).filter(s => s.length > 0);

    if (searchTerms.length === 0) {
      this.clearHeaderSearchFilter();
      return;
    }

    // Get all albums
    let allAlbums = Model.library.albums;
    if (!allAlbums) {
      return;
    }

    // Filter albums based on search terms (AND logic)
    let filteredAlbums = allAlbums.filter(album => {
      // For each search term, check if album matches
      // ALL terms must match for the album to be included
      const matchesAllSearchTerms = searchTerms.every(searchVal => this.albumMatchesSearchTerm(album, searchVal));
      return matchesAllSearchTerms;
    });

    // Make sure albums list is visible
    ViewUtil.setDisplayed(this.albumsList.$el, true);

    // Set filtered albums to albums list and force dirty flags to rebuild
    this.albumsList.albums = filteredAlbums;
    this.albumsList.filteredSortedAlbumsDirty = true;
    this.albumsList.groupsDirty = true;
    this.albumsList.domDirty = true;
    this.albumsList.setFilterType('none');
    this.albumsList.update();

    // Update header to show filtered count
    this.$title.text('Library');
    const count = filteredAlbums.length;
    const suffix = (count == 1) ? ' album' : ' albums';
    this.$itemCount.text(count + suffix);

    // Update album count in toolbar
    $('#albumCount').text(count);
  }

  /**
   * Clear header search filter and show all albums.
   */
  clearHeaderSearchFilter() {
    // Get all albums
    let allAlbums = Model.library.albums;
    if (!allAlbums) {
      return;
    }

    // Make sure albums list is visible
    ViewUtil.setDisplayed(this.albumsList.$el, true);

    // Set all albums to albums list and force dirty flags to rebuild
    this.albumsList.albums = allAlbums;
    this.albumsList.filteredSortedAlbumsDirty = true;
    this.albumsList.groupsDirty = true;
    this.albumsList.domDirty = true;
    this.albumsList.setFilterType('none');
    this.albumsList.update();

    // Update header to show all albums count
    this.$title.text('Library');
    const count = allAlbums.length;
    const suffix = (count == 1) ? ' album' : ' albums';
    this.$itemCount.text(count + suffix);

    // Update album count in toolbar
    $('#albumCount').text(count);
  }
}
