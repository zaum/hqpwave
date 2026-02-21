import AlbumUtil from './album-util.js';
import DataUtil from './data-util.js';
import LibraryAlbumOptionsView from './library-album-options-view.js';
import LibraryAlbumsList from './library-albums-list.js';
import LibrarySearchPanel from './library-search-panel.js';
import LibrarySearchList from './library-search-list.js';
import LibraryDataUtil from './library-data-util.js';
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

  albumOptionsView; // dropdowns + search button
  $searchButton;
  $searchCloseButton;

  searchPanel;
  albumsList;
  searchList;

  constructor() {
    super($("#libraryView"));
    this.$title = this.$el.find('#libraryTitle');
    this.$itemCount = this.$el.find('#libraryNumbers');
    this.$searchButton = this.$el.find('#librarySearchButton');
    this.$searchCloseButton = this.$el.find('#librarySearchCloseButton');
    this.$spinner = this.$el.find('#librarySpinner');
    this.$headerSearchInput = this.$el.find('#libraryHeaderSearchInput');
    this.$headerSearchContainer = this.$el.find('#libraryHeaderSearchContainer');
    this.$headerSearchClearButton = this.$el.find('#libraryHeaderSearchClear');

    this.albumOptionsView = new LibraryAlbumOptionsView(this.$el.find("#libraryAlbumOptionsView"));
    this.albumsList = new LibraryAlbumsList(this.$el.find('#libraryAlbumsList'));
    this.searchPanel = new LibrarySearchPanel(this.$el.find("#librarySearchPanel"));
    this.searchList = new LibrarySearchList(this.$el.find('#librarySearchList'));

    this.$searchButton.on('click tap', () => this.openSearch());
    this.$searchCloseButton.on('click tap', () => this.closeSearch());
    
    // Header search input functionality - filter albums in place (search as you type)
    this._headerSearchDebounceTimer = null;
    this._headerSearchMinLength = 2;
    this._headerSearchDebounceDelay = 300;
    
    this.$headerSearchInput.on('input', (e) => {
      // Clear any existing debounce timer
      if (this._headerSearchDebounceTimer) {
        clearTimeout(this._headerSearchDebounceTimer);
      }
      
      const value = this.$headerSearchInput.val().trim();
      
      // Update clear button visibility
      this.updateHeaderSearchClearButtonVisibility();
      
      if (value.length === 0) {
        // Clear search filter and show all albums
        this.clearHeaderSearchFilter();
        return;
      }
      
      // Start new debounce timer for search-as-you-type filtering
      if (value.length >= this._headerSearchMinLength) {
        this._headerSearchDebounceTimer = setTimeout(() => {
          this.applyHeaderSearchFilter(value);
        }, this._headerSearchDebounceDelay);
      }
    });
    
    this.$headerSearchInput.on('keyup', (e) => {
      if (e.keyCode === 13) { // Enter key - cancel debounce and filter immediately
        if (this._headerSearchDebounceTimer) {
          clearTimeout(this._headerSearchDebounceTimer);
          this._headerSearchDebounceTimer = null;
        }
        const value = this.$headerSearchInput.val().trim();
        if (value.length === 0) {
          // If empty, show all albums (pre-search state)
          this.clearHeaderSearchFilter();
        } else if (value.length >= this._headerSearchMinLength) {
          this.applyHeaderSearchFilter(value);
        }
      }
    });
    
    // Clear button click handler
    this.$headerSearchClearButton.on('click', () => {
      this.clearHeaderSearchFilter();
      this.$headerSearchInput.focus();
    });
    Util.addAppListener(this, 'model-library-updated', this.onModelLibraryUpdated);
    Util.addAppListener(this, 'library-albums-filter-changed library-albums-list-populated',
        () => this.updateHeaderText(false));
    Util.addAppListener(this, 'library-albums-list-populated',
        () => this.syncExpandCollapseButtonState());
    Util.addAppListener(this, 'library-search-view-populated',
        () => this.updateHeaderText(true));
    Util.addAppListener(this, 'library-search', this.onSearch);
    Util.addAppListener(this, 'library-expand-all-groups', this.onExpandAllGroups);
    Util.addAppListener(this, 'library-collapse-all-groups', this.onCollapseAllGroups);
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

    this.searchList.hide();
    this.albumsList.show();
    this.albumsList.update();
	}

  /**
   * Animates in search view state.
   */
  openSearch() {
    $(document).trigger('disable-user-input');
    TopBarUtil.returnSubviewHeader(true)
    this.albumsList.hide(false, () => {
      this.updateHeaderText(true);
      ViewUtil.setDisplayed(this.albumOptionsView.$el, false);
      ViewUtil.setDisplayed(this.$searchCloseButton, true);
      ViewUtil.setDisplayed(this.$headerSearchContainer, false);
      this.searchPanel.show();
      this.searchList.show();
      $(document).trigger('enable-user-input');
    });
  }

  /**
   * Shows search view state synchronously, with list populated.
   */
  openSearchSync(searchType, value) {
    TopBarUtil.returnSubviewHeader(true)
    this.updateHeaderText(true);
    ViewUtil.setDisplayed(this.albumOptionsView.$el, false);
    ViewUtil.setDisplayed(this.$searchCloseButton, true);
    ViewUtil.setDisplayed(this.$headerSearchContainer, false);
    this.albumsList.hide(true);
    this.searchPanel.show(searchType, value, true);
    
    // Sync header search input value to search panel input
    if (value && value.trim() && this.$headerSearchInput.val() !== value) {
      this.$headerSearchInput.val(value);
    }
    
    // Simulate Enter key press to trigger search when external data is provided
    if (value && value.trim()) {
      this.searchPanel.$input.trigger($.Event('keyup', { keyCode: 13 }));
    }
    
    this.searchList.setSearchTypeAndValue(searchType, value);
    this.searchList.show(true);
  }
  /**
   * Animates out search view state.
   */
  closeSearch() {
    $(document).trigger('disable-user-input');
    TopBarUtil.returnSubviewHeader(true)
    this.searchList.hide();
    this.searchPanel.hide(() => {
      this.$el[0].scrollTop = 0;
      ViewUtil.setDisplayed(this.$searchCloseButton, false);
      ViewUtil.setDisplayed(this.albumOptionsView.$el, 'flex');
      // Restore albums from model and show albums list
      if (Model.library.albums) {
        this.albumsList.albums = Model.library.albums;
        this.albumsList.filteredSortedAlbumsDirty = true;
        this.albumsList.groupsDirty = true;
        this.albumsList.domDirty = true;
      }
      this.albumsList.setFilterType(Settings.libraryFilterType);
      this.albumsList.update();
      this.albumsList.show();
      this.updateHeaderText(false);
      // Clear the header search input
      this.$headerSearchInput.val('');
      // Show the header search container
      ViewUtil.setDisplayed(this.$headerSearchContainer, true);
      $(document).trigger('enable-user-input');
    });
  }

  onModelLibraryUpdated() {
    this.albumsList.setAlbums(Model.library.albums);
    this.searchList.setAlbums(Model.library.albums);
  }

  onSearch(type, value) {
    this.albumsList.clear();
    this.albumsList.hide();
    this.searchList.show();
    this.searchList.setSearchTypeAndValue(type, value);
  }

  onExpandAllGroups() {
    const list = ViewUtil.isDisplayed(this.albumsList.$el) ? this.albumsList : this.searchList;
    list.expandAllGroups();
  }

  onCollapseAllGroups() {
    const list = ViewUtil.isDisplayed(this.albumsList.$el) ? this.albumsList : this.searchList;
    list.collapseAllGroups();
  }

  /**
   * Syncs the expand/collapse button state with the actual group states.
   */
  syncExpandCollapseButtonState() {
    const list = ViewUtil.isDisplayed(this.albumsList.$el) ? this.albumsList : this.searchList;
    const areAllCollapsed = list.areAllLabelsCollapsed;
    
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
    if (ViewUtil.isDisplayed(this.searchPanel.$el)) {
      this.closeSearch();
      return true;
    } else { // is albums list
      if (this.$el[0].scrollTop > 0) {
        this.$el[0].scrollTop = 0;
        return true;
      }
    }
    return false;
  }

  updateHeaderText(isForSearch) {

    const headingText = isForSearch ? 'Search' : 'Library';
    this.$title.text(headingText);

    let count;
    if (isForSearch) {
      const isEmpty = (this.searchList.$el[0].childNodes.length == 0);
      count = isEmpty ? 0 : this.searchList.getItemCount();
    } else {
      count = this.albumsList.filteredSortedAlbums.length;
    }

    let countText;
    if (isForSearch && count == 0) {
      countText = '';
    } else {
      const isTracks = isForSearch &&
          (this.searchList.getSearchType() == 'track' || this.searchList.getSearchType() == 'trackFavorites');
      let suffix;
      if (isTracks) {
        suffix = (count == 1) ? ' track' : ' tracks';
      } else {
        suffix = (count == 1) ? ' album' : ' albums';
      }
      countText = count + suffix;
    }
    this.$itemCount.text(countText);
  }

  /**
   * Apply search filter to albums list - filters in place without showing search panel
   */
  applyHeaderSearchFilter(value) {
    const searchValue = value.toLowerCase();
    
    // Get all albums
    let allAlbums = Model.library.albums;
    if (!allAlbums) {
      return;
    }
    
    // Filter albums that match the search value
    const filteredAlbums = allAlbums.filter(album => {
      // Check album-level fields
      const artist = album['@_artist'] ? album['@_artist'].toLowerCase() : '';
      const albumName = album['@_album'] ? album['@_album'].toLowerCase() : '';
      const genre = album['@_genre'] ? album['@_genre'].toLowerCase() : '';
      const year = album['@_year'] ? album['@_year'].toLowerCase() : '';
      
      if (artist.includes(searchValue) || 
          albumName.includes(searchValue) || 
          genre.includes(searchValue) || 
          year.includes(searchValue)) {
        return true;
      }
      
      // Check track-level fields
      const tracks = AlbumUtil.getTracksOf(album);
      for (const track of tracks) {
        const song = track['@_song'] ? track['@_song'].toLowerCase() : '';
        if (song.includes(searchValue)) {
          return true;
        }
      }
      
      return false;
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
  }

  /**
   * Clear search filter and show all albums
   */
  clearHeaderSearchFilter() {
    // Clear the header search input
    this.$headerSearchInput.val('');
    
    // Hide clear button
    this.$headerSearchClearButton.hide();
    
    // Make sure albums list is visible
    ViewUtil.setDisplayed(this.albumsList.$el, true);
    
    // Restore all albums from model and force rebuild
    if (Model.library.albums) {
      this.albumsList.albums = Model.library.albums;
      this.albumsList.filteredSortedAlbumsDirty = true;
      this.albumsList.groupsDirty = true;
      this.albumsList.domDirty = true;
    }
    this.albumsList.setFilterType(Settings.libraryFilterType);
    this.albumsList.update();
    
    // Update header to show total count
    this.$title.text('Library');
    const count = this.albumsList.filteredSortedAlbums ? this.albumsList.filteredSortedAlbums.length : 0;
    const suffix = (count == 1) ? ' album' : ' albums';
    this.$itemCount.text(count + suffix);
  }

  updateHeaderSearchClearButtonVisibility() {
    const hasValue = this.$headerSearchInput.val().trim().length > 0;
    if (hasValue) {
      this.$headerSearchClearButton.show();
    } else {
      this.$headerSearchClearButton.hide();
    }
  }
}
