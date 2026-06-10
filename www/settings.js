import ThresholdRuleView from './threshold-rule-view.js';
import AbRuleView from './ab-rule-view.js';

/**
 * User settings, backed by local storage.
 */
class Settings {

  storage = window.localStorage; // todo handle disabledness

  _librarySearchType;
  _librarySearchValue;
  _librarySortType;
  _librarySortOrder;
  _librarySortDirection;
  _libraryGroupType;
  _libraryFilterType;
  _libraryCollapsedGroups;
  _colorTheme;
  _showPlayButton;
  _showFormatOverlay;
  _showLogoAnimation;
  _artistReleaseLimit;
  _artistImageLimit;
  _artistBioLimit;
  _presetsArray;
  _currentRule;
  _thresholdRule;
  _abRule;

  constructor() {
    this.initFromLocalStorage();
  }

  initFromLocalStorage() {
    let s;

    this._librarySearchType = this.storage.getItem('librarySearchType') || 'all';

    this._librarySearchValue = this.storage.getItem('librarySearchValue') || '';

    this._librarySortType = this.storage.getItem('librarySortType') || 'artist';
    this._librarySortOrder = this.storage.getItem('librarySortOrder') || 'dateAdded';
    this._librarySortDirection = this.storage.getItem('librarySortDirection') || 'asc';
    this._libraryGroupType = this.storage.getItem('libraryGroupType') || 'none';
    this._libraryFilterType = this.storage.getItem('libraryFilterType') || 'none';

    s = this.storage.getItem('libraryCollapsedGroups');
    try {
      this._libraryCollapsedGroups = JSON.parse(s) || {};
    } catch (exc) {
      cl('warning', s, exc);
      this._libraryCollapsedGroups = {};
    }

    this._colorTheme = this.storage.getItem('colorTheme') || 'dark';
    this._showPlayButton = this.storage.getItem('showPlayButton') || 'true';
    this._showFormatOverlay = this.storage.getItem('showFormatOverlay') || 'true';
    this._showLibraryDateAndFormat = this.storage.getItem('showLibraryDateAndFormat') || 'true';
    this._showLogoAnimation = this.storage.getItem('showLogoAnimation') || 'true';
    this._highlightColor = this.storage.getItem('highlightColor') || '#e8c88a';
    this._playerBackgroundColor = this.storage.getItem('playerBackgroundColor') || '#111112';
    this._artistReleaseLimit = this._sanitizeArtistReleaseLimit(this.storage.getItem('artistReleaseLimit'));
    this._artistImageLimit = this._sanitizeArtistImageLimit(this.storage.getItem('artistImageLimit'));
    this._artistBioLimit = this._sanitizeArtistBioLimit(this.storage.getItem('artistBioLimit'));

    s = this.storage.getItem('presetsArray');
    try {
      this._presetsArray = JSON.parse(s) || [];
    } catch (exc) {
      cl('warning', s, exc);
      this._presetsArray = [];
    }

    this._currentRule = this.storage.getItem('currentRule') || '';

    s = this.storage.getItem('thresholdRule');
    try {
      this._thresholdRule = JSON.parse(s);
    } catch (exc) {
      cl('warning', s, exc);
    }
    if (!this._thresholdRule) {
      this._thresholdRule = ThresholdRuleView.getDefaultValues();
    }

    s = this.storage.getItem('abRule');
    try {
      this._abRule = JSON.parse(s);
    } catch (exc) {
      cl('warning', s, exc);
    }
    if (!this._abRule) {
      this._abRule = AbRuleView.getDefaultValues();
    }
  }

  get librarySearchType() {
    return this._librarySearchType;
  }

  set librarySearchType(s) {
    this._librarySearchType = s;
    this.storage.setItem('librarySearchType', s);
  }

  get librarySearchValue() {
    return this._librarySearchValue;
  }

  set librarySearchValue(s) {
    this._librarySearchValue = s;
    this.storage.setItem('librarySearchValue', s);
  }

  get librarySortType() {
    return this._librarySortType;
  }

  set librarySortType(s) {
    this._librarySortType = s;
    this.storage.setItem('librarySortType', s);
  }

  get librarySortOrder() {
    return this._librarySortOrder;
  }

  set librarySortOrder(s) {
    this._librarySortOrder = s;
    this.storage.setItem('librarySortOrder', s);
  }

  get librarySortDirection() {
    return this._librarySortDirection;
  }

  set librarySortDirection(s) {
    this._librarySortDirection = s;
    this.storage.setItem('librarySortDirection', s);
  }

  get libraryGroupType() {
    return this._libraryGroupType;
  }

  set libraryGroupType(s) {
    this._libraryGroupType = s;
    this.storage.setItem('libraryGroupType', s);
  }

  get libraryFilterType() {
    return this._libraryFilterType;
  }

  set libraryFilterType(s) {
    this._libraryFilterType = s;
    this.storage.setItem('libraryFilterType', s);
  }

  // ---

  isLibraryGroupCollapsed(key) {
    return !!this._libraryCollapsedGroups[key]
  }

  setLibraryGroupCollapsed(key, isCollapsed) {
    if (isCollapsed) {
      this._libraryCollapsedGroups[key] = 1;
      this._commitLibraryCollapsedGroups();
    } else {
      if (this._libraryCollapsedGroups[key] !== undefined) {
        delete this._libraryCollapsedGroups[key];
        this._commitLibraryCollapsedGroups();
      }
    }
  }

  /* Batch update */
  setLibraryGroupsCollapsed(keys, isCollapsed) {
    if (isCollapsed) {
      for (const key of keys) {
        this._libraryCollapsedGroups[key] = 1;
      }
    } else {
      for (const key of keys) {
        delete this._libraryCollapsedGroups[key];
      }
    }
    this._commitLibraryCollapsedGroups();
  }

  _commitLibraryCollapsedGroups() {
    const s = JSON.stringify(this._libraryCollapsedGroups);
    this.storage.setItem('libraryCollapsedGroups', s);
  }

  // ---

  get colorTheme() {
    return this._colorTheme;
  }

  set colorTheme(s) {
    this._colorTheme = s;
    this.storage.setItem('colorTheme', s);
  }

  get highlightColor() {
    return this._highlightColor;
  }

  set highlightColor(s) {
    this._highlightColor = s;
    this.storage.setItem('highlightColor', s);
  }

  get playerBackgroundColor() {
    return this._playerBackgroundColor;
  }

  set playerBackgroundColor(s) {
    this._playerBackgroundColor = s;
    this.storage.setItem('playerBackgroundColor', s);
  }

  

  get showPlayButton() {
    return (this._showPlayButton === 'true');
  }

  set showPlayButton(b) {
    const s = (b === true || b === 'true') ? 'true' : 'false';
    this._showPlayButton = s;
    this.storage.setItem('showPlayButton', s);
    $(document).trigger('settings-show-play-button-changed');
  }

  get showFormatOverlay() {
    return (this._showFormatOverlay === 'true');
  }

  set showFormatOverlay(b) {
    const s = (b === true || b === 'true') ? 'true' : 'false';
    this._showFormatOverlay = s;
    this.storage.setItem('showFormatOverlay', s);
    $(document).trigger('settings-show-format-overlay-changed');
  }

  get showLibraryDateAndFormat() {
    return (this._showLibraryDateAndFormat === 'true');
  }

  set showLibraryDateAndFormat(b) {
    const s = (b === true || b === 'true') ? 'true' : 'false';
    this._showLibraryDateAndFormat = s;
    this.storage.setItem('showLibraryDateAndFormat', s);
    $(document).trigger('settings-show-library-date-and-format-changed');
  }

  get showLogoAnimation() {
    return (this._showLogoAnimation === 'true');
  }

  set showLogoAnimation(b) {
    const s = (b === true || b === 'true') ? 'true' : 'false';
    this._showLogoAnimation = s;
    this.storage.setItem('showLogoAnimation', s);
    $(document).trigger('settings-show-logo-animation-changed');
  }

  _sanitizeArtistReleaseLimit(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 99;
    }
    return Math.min(parsed, 9999);
  }

  get artistReleaseLimit() {
    return this._artistReleaseLimit;
  }

  set artistReleaseLimit(value) {
    const sanitized = this._sanitizeArtistReleaseLimit(value);
    this._artistReleaseLimit = sanitized;
    this.storage.setItem('artistReleaseLimit', String(sanitized));
  }

  _sanitizeArtistImageLimit(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 5;
    }
    return Math.min(parsed, 99);
  }

  get artistImageLimit() {
    return this._artistImageLimit;
  }

  set artistImageLimit(value) {
    const sanitized = this._sanitizeArtistImageLimit(value);
    this._artistImageLimit = sanitized;
    this.storage.setItem('artistImageLimit', String(sanitized));
  }

  _sanitizeArtistBioLimit(value) {
    if (value === null || value === undefined) {
      return 4000;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 1) {
      return 4000;
    }
    return Math.min(parsed, 99999);
  }

  get artistBioLimit() {
    return this._artistBioLimit;
  }

  set artistBioLimit(value) {
    const sanitized = this._sanitizeArtistBioLimit(value);
    this._artistBioLimit = sanitized;
    this.storage.setItem('artistBioLimit', String(sanitized));
    $(document).trigger('settings-artist-bio-limit-changed');
  }

  get presetsArray() {
    return this._presetsArray;
  }

  commitPresetsArray() {
    const s = JSON.stringify(this._presetsArray);
    this.storage.setItem('presetsArray', s);
  }

  get currentRule() {
    return this._currentRule;
  }

  set currentRule(s) {
    this._currentRule = s;
    this.storage.setItem('currentRule', s);
  }

  get thresholdRule() {
    return this._thresholdRule;
  }
  
  commitThresholdRule() {
    const s = JSON.stringify(this._thresholdRule);
    this.storage.setItem('thresholdRule', s);
  }

  isThresholdRuleValid() {
    const b = (this._thresholdRule.leastMost == 'least') || (this._thresholdRule.leastMost == 'most');
    if (!b) {
      cl('bad value for leastmost');
      return false;
    }
    const multiple = parseInt(this._thresholdRule.fs);
    if (!(multiple > 0)) {
      cl('warning bad multiple');
      return false;
    }
    return true;
  }

  get abRule() {
    return this._abRule;
  }

  commitAbRule() {
    const s = JSON.stringify(this._abRule);
    this.storage.setItem('abRule', s);
  }
}

export default new Settings();
