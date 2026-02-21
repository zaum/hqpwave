import Settings from './settings.js';
import Util from './util.js';
import ViewUtil from './view-util.js';

/**
 *
 */
export default class LibrarySearchPanel {

  $el;

  $allTabButton;
  $artistsTabButton;
  $albumsTabButton;
  $genresTabButton;
  $yearsTabButton;
  $tracksTabButton;
  tabButtons$;

  $tabContent;
  $input;
  $okButton;

  $albumFavoritesButton;
  $trackFavoritesButton;

  _searchType;
  _tabType; // 'enum' subset of searchType. tricky.
  _debounceTimer; // for search-as-you-type
  _minSearchLength = 2; // minimum characters to trigger search
  _debounceDelay = 300; // ms to wait before searching

  constructor($el) {
    this.$el = $el;
    this.$allTabButton = $el.find('#allTabButton');
    this.$artistsTabButton = $el.find('#artistsTabButton');
    this.$albumsTabButton = $el.find('#albumsTabButton');
    this.$genresTabButton = $el.find('#genresTabButton');
    this.$yearsTabButton = $el.find('#yearsTabButton');
    this.$tracksTabButton = $el.find('#tracksTabButton');
    this.tabButtons$ = [ this.$allTabButton, this.$artistsTabButton, this.$albumsTabButton, this.$genresTabButton, this.$yearsTabButton, this.$tracksTabButton];
    this.$tabContent = $el.find('#searchTabContent');
    this.$input = $el.find('#librarySearchInput');
    this.$okButton = $el.find('#librarySearchOkButton');
    this.$albumFavoritesButton = $el.find('#albumFavoritesButton');
    this.$trackFavoritesButton = $el.find('#trackFavoritesButton');

    this.$allTabButton.on('click tap', this.onTabButton);
    this.$artistsTabButton.on('click tap', this.onTabButton);
    this.$albumsTabButton.on('click tap', this.onTabButton);
    this.$genresTabButton.on('click tap', this.onTabButton);
    this.$yearsTabButton.on('click tap', this.onTabButton);
    this.$tracksTabButton.on('click tap', this.onTabButton);
    this.$okButton.on('click tap', this.onOkButton);
    this.$albumFavoritesButton.on('click tap', this.onAlbumFavoritesButton);
    this.$trackFavoritesButton.on('click tap', this.onTrackFavoritesButton);
    Util.addAppListener(this, 'library-search-list-cleared', () => this.searchType = null);

    this.$tabContent.addClass('isEnabled');

    this.tabType = 'all'; // default

    this.hide();
  }

  show(type=null, value=null, now=false) {
    this.searchType = type;
    this.$input[0].value = value;

    this.$input.on('input', this.onInputInput);
    this.$input.on('keyup', this.onInputKeyUp);

    ViewUtil.setDisplayed(this.$el, true);

    // Don't focus on search field when triggered externally (e.g., genre/artist click)
    const shouldFocus = now && !(value && value.trim());

    if (now) {
      ViewUtil.setCssSync(this.$el, () => this.$el.css('opacity', 1));
      if (shouldFocus) {
        this.$input.focus();
      }
    } else {
      ViewUtil.animateCss(this.$el,
          () => this.$el.css('opacity', 0),
          () => this.$el.css('opacity', 1),
          () => {
            if (shouldFocus) {
              this.$input.focus();
            }
          });
    }

    // If value is provided (external trigger like genre click), auto-trigger search
    if (value && value.trim()) {
      this.$okButton.click();
    }
    
    // Add clear button to search input container
    this.addClearButton();
    
    // Update clear button visibility based on initial value
    this.updateClearButtonVisibility();
  }
  addClearButton() {
    // Check if clear button already exists
    if (this.$input.siblings('.searchClearButton').length === 0) {
      const $clearButton = $('<span class="searchClearButton">×</span>');
      $clearButton.on('click', this.onClearButton);
      this.$input.after($clearButton);
    }
  }
  updateClearButtonVisibility() {
    const hasValue = this.$input[0].value.length > 0;
    const $clearButton = this.$input.siblings('.searchClearButton');
    if (hasValue) {
      $clearButton.show();
    } else {
      $clearButton.hide();
    }
  }
  onInputInput = (e) => {
    // Clear any existing debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    
    // Update clear button visibility
    this.updateClearButtonVisibility();
    
    // Start new debounce timer
    this._debounceTimer = setTimeout(() => {
      const value = this.getMassagedInput();
      
      // Only search if minimum characters reached
      if (value.length >= this._minSearchLength) {
        $(document).trigger('library-search', [this._tabType, value]);
        this.searchType = this._tabType;
      } else if (value.length === 0) {
        // Clear search results if input is empty
        $(document).trigger('library-search', [this._tabType, '']);
        this.searchType = this._tabType;
      }
    }, this._debounceDelay);
  };
  onClearButton = () => {
    this.$input[0].value = '';
    // Trigger search with empty value to clear results
    $(document).trigger('library-search', [this._tabType, '']);
    this.searchType = this._tabType;
    this.$input.focus();
  };

  hide(callback) {
    // Clear any pending debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    
    if (!ViewUtil.isDisplayed(this.$el)) {
      if (callback) {
        callback();
      }
      return;
    }
    this.$input.off('input', this.onInputInput);
    this.$input.off('keyup', this.onInputKeyUp);

    // Remove clear button when hiding
    this.$input.siblings('.searchClearButton').remove();

    ViewUtil.animateCss(this.$el,
        () => this.$el.css('opacity', 1),
        () => this.$el.css('opacity', 0),
        () => {
          ViewUtil.setDisplayed(this.$el, false)
          if (callback) {
            callback();
          }
        });
  }

  /**
   * Sets the search type and updates view state (complicated).
   */
  set searchType(value) {

    this._searchType = value;

    for (const $tabButton of this.tabButtons$) {
      $tabButton.removeClass('isSelected');
    }
    this.$albumFavoritesButton.removeClass('isSelected');
    this.$trackFavoritesButton.removeClass('isSelected');

    let $el;
    switch (this._searchType) {
      case 'all':
        $el = this.$allTabButton;
        break;
      case 'artist':
        $el = this.$artistsTabButton;
        break;
      case 'album':
        $el = this.$albumsTabButton;
        break;
      case 'genre':
        $el = this.$genresTabButton;
        break;
      case 'year':
        $el = this.$yearsTabButton;
        break;
      case 'track':
        $el = this.$tracksTabButton;
        break;
      case 'albumFavorites':
        $el = this.$albumFavoritesButton;
        break;
      case 'trackFavorites':
        $el = this.$trackFavoritesButton;
        break;
      default:
        return;
    }
    if ($el) {
      $el.addClass('isSelected');
    }

    switch (this._searchType) {
      case 'all':
      case 'artist':
      case 'album':
      case 'genre':
      case 'year':
      case 'track':
        this.tabType = this._searchType;
        break;
      case 'albumFavorites':
      case 'trackFavorites':
        this.$input[0].value = '';
        break;
      default:
        return;
    }
  }

  set tabType(type) {

    this._tabType = type;

    // update .isOn and placeholder text
    let placeholder;
    let $tabButton;
    switch (this._tabType) {
      case 'all':
        $tabButton = this.$allTabButton;
        placeholder = 'Search everywhere in metadata';
        break;
      case 'artist':
        $tabButton = this.$artistsTabButton;
        placeholder = 'Search album artist names';
        break;
      case 'album':
        $tabButton = this.$albumsTabButton;
        placeholder = 'Search album titles';
        break;
      case 'genre':
        $tabButton = this.$genresTabButton;
        placeholder = 'Search album genres';
        break;
      case 'year':
        $tabButton = this.$yearsTabButton;
        placeholder = 'Search album year (eg, 2012 or 1968-1972)';
        break;
      case 'track':
        $tabButton = this.$tracksTabButton;
        placeholder = 'Search track titles';
        break;
      default:
        cl('warning logic');
        return;
    }
    for (const $b of this.tabButtons$) {
      $b.removeClass('isOn');
    }
    $tabButton.addClass('isOn');
    this.$input.attr('placeholder', placeholder);
  }

  getMassagedInput() {
    let s = this.$input[0].value;
    s = s.trim(); // todo other chars?
    return s;
  }

  massageInput() {
    const s = this.getMassagedInput();
    this.$input[0].value = s;
  }

  onInputKeyUp = (e) => {
    if (e.keyCode == 13) {
      this.$okButton.click();
    } else if (e.keyCode == 27) {
      $(document).trigger('app-do-escape');
    }
  };

  onInputInput = (e) => {
    // Clear any existing debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    
    // Start new debounce timer
    this._debounceTimer = setTimeout(() => {
      const value = this.getMassagedInput();
      
      // Only search if minimum characters reached
      if (value.length >= this._minSearchLength) {
        $(document).trigger('library-search', [this._tabType, value]);
        this.searchType = this._tabType;
      } else if (value.length === 0) {
        // Clear search results if input is empty
        $(document).trigger('library-search', [this._tabType, '']);
        this.searchType = this._tabType;
      }
    }, this._debounceDelay);
  };

  onOkButton = () => {
    this.massageInput();
    const value = this.getMassagedInput();
    $(document).trigger('library-search', [this._tabType, value]);
    this.searchType = this._tabType;
  };

  onTabButton = (e) => {
    const value = $(e.currentTarget).attr('data-value') ;
    if (value == this._searchType) {
      return;
    }
    this.tabType = value;

    ViewUtil.setFocus(this.$input[0]);
    this.$input[0].value = '';
  };

  onAlbumFavoritesButton = (e) => {
    this.searchType = 'albumFavorites';
    $(document).trigger('library-search', [this._searchType]);
  };

  onTrackFavoritesButton = (e) => {
    this.searchType = 'trackFavorites';
    $(document).trigger('library-search', [this._searchType]);
  };
}
