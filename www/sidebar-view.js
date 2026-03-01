import AppUtil from './app-util.js';
import MetaUtil from './meta-util.js';
import Model from './model.js';
import Settings from './settings.js';
import Util from './util.js';
import ViewUtil from './view-util.js';

/**
 * Sidebar view for filtering albums.
 */
class SidebarView {

  $el;
  $page;
  $scroll;
  $toggle;
  $resetButton;
  $formatChips;
  $genreList;
  $browseItems;

  // Filter state
  activeFormats = new Set();
  activeGenres = new Set();
  activePeriods = new Set(); // store period elements or data
  browseFilter = 'all-albums'; // 'all-albums', 'favorite-albums', 'favorite-tracks'
  genreMultiSelect = false;
  periodMultiSelect = false;

  constructor() {
    this.$el = $('#sidebar');
    this.$page = $('#page');

    // Wrap existing content in a scroll container so the toggle
    // can stay centered and not move with scroll.
    this.$scroll = $('<div class="sidebar-scroll"></div>');
    const $existingChildren = this.$el.children().detach();
    this.$scroll.append($existingChildren);
    this.$el.append(this.$scroll);

    // Collapse/expand toggle
    this.$toggle = $(`
      <button type="button" id="sidebarToggle" aria-label="Collapse sidebar" title="Hide sidebar">
        &lt;
      </button>
    `);
    this.$el.append(this.$toggle);
    this.$toggle.on('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleCollapsed();
    });
    this.syncToggleIcon();

    this.$resetButton = $('#resetFilters');
    this.$formatChips = this.$el.find('.fchip');
    this.$genreList = $('#genreList');
    this.$periodList = $('#periodList');
    this.$browseItems = this.$el.find('.sidebar-item[data-filter]');

    // Format chip click handler (OR logic - multiple can be selected)
    this.$formatChips.on('click', (e) => {
      const $chip = $(e.currentTarget);
      const format = $chip.data('format');

      if (this.activeFormats.has(format)) {
        this.activeFormats.delete(format);
        $chip.removeClass('active');
      } else {
        this.activeFormats.add(format);
        $chip.addClass('active');
      }

      this.onFiltersChanged();
    });

    // Browse item click handler (single select)
    this.$browseItems.on('click', (e) => {
      const $item = $(e.currentTarget);
      const filter = $item.data('filter');

      // Update active state
      this.$browseItems.removeClass('active');
      $item.addClass('active');
      this.browseFilter = filter;

      this.onFiltersChanged();
    });

    // Reset button click handler
    this.$resetButton.on('click', () => {
      this.resetFilters();
    });

    // Individual reset buttons
    $('#resetBrowse').on('click', () => {
      this.resetBrowseFilter();
    });

    $('#resetFormat').on('click', () => {
      this.resetFormatFilter();
    });

    $('#resetGenre').on('click', () => {
      this.resetGenreFilter();
    });

    $('#resetPeriod').on('click', () => {
      this.resetPeriodFilter();
    });

    // Initialize period filters
    this.initPeriodFilters();

    // Listen for library updates to populate genre list
    Util.addAppListener(this, 'model-library-updated', this.onModelLibraryUpdated);
    Util.addAppListener(this, 'meta-load-result', this.onMetaLoadResult);
    Util.addAppListener(this, 'album-favorite-changed', this.onAlbumFavoriteChanged);
    Util.addAppListener(this, 'meta-track-favorite-changed', this.onTrackFavoriteChanged);

    // Initial population
    if (Model.library && Model.library.albums) {
      this.onModelLibraryUpdated();
    }

    // Set initial active state for "All Albums"
    this.$browseItems.filter('[data-filter="all-albums"]').addClass('active');
  }

  toggleCollapsed() {
    this.$page.toggleClass('isSidebarCollapsed');
    this.syncToggleIcon();
  }

  syncToggleIcon() {
    const isCollapsed = this.$page.hasClass('isSidebarCollapsed');
    if (isCollapsed) {
      this.$toggle.html('&gt;');
      this.$toggle.attr('aria-label', 'Expand sidebar');
      this.$toggle.attr('title', 'Show sidebar');
    } else {
      this.$toggle.html('&lt;');
      this.$toggle.attr('aria-label', 'Collapse sidebar');
      this.$toggle.attr('title', 'Hide sidebar');
    }
  }

  /**
   * Called when model library is updated.
   */
  onModelLibraryUpdated() {
    this.updateCounts();
    this.populateGenreList();
    this.updatePeriodCounts();
  }

  onMetaLoadResult = () => {
    this.updateCounts();
  }

  onAlbumFavoriteChanged = () => {
    this.updateCounts();
    if (this.browseFilter === 'favorite-albums') {
      this.onFiltersChanged();
    }
  }

  onTrackFavoriteChanged = () => {
    this.updateCounts();
    if (this.browseFilter === 'favorite-tracks') {
      this.onFiltersChanged();
    }
  }

  /**
   * Update sidebar counts.
   */
  updateCounts() {
    const albums = Model.library.albums || [];

    // All albums count
    $('#countAllAlbums').text(albums.length);

    // Favorite albums count
    const favoriteAlbums = albums.filter(a => {
      const albumHash = a['@_hash'];
      return MetaUtil.isAlbumFavoriteFor(albumHash);
    });
    $('#countFavoriteAlbums').text(favoriteAlbums.length);

    // Favorite tracks count - need to count from meta
    const favoriteTrackCount = MetaUtil.getFavoriteTrackCount();
    $('#countFavoriteTracks').text(favoriteTrackCount);
  }

  /**
   * Populate genre list from library.
   */
  populateGenreList() {
    const albums = Model.library.albums || [];
    const genreMap = new Map();

    // Collect genres with counts
    for (const album of albums) {
      const genre = album['@_genre'];
      if (genre) {
        const count = genreMap.get(genre) || 0;
        genreMap.set(genre, count + 1);
      }
    }

    // Sort genres alphabetically
    const sortedGenres = Array.from(genreMap.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })
    );

    // Build genre list HTML
    this.$genreList.empty();

    for (const [genre, count] of sortedGenres) {
      const $item = $(`
        <div class="genre-item" data-genre="${this.escapeHtml(genre)}">
          <span class="genre-name" style="color: var(--text-2)">${this.escapeHtml(genre)}</span>
          <span class="genre-count">${count}</span>
        </div>
      `);

      // Hover handlers for genre items
      $item.on('mouseenter', () => {
        if (!this.activeGenres.has($item.data('genre'))) {
          $item.find('.genre-name').css('color', 'var(--text)');
        }
      });

      $item.on('mouseleave', () => {
        if (!this.activeGenres.has($item.data('genre'))) {
          $item.find('.genre-name').css('color', 'var(--text-2)');
        }
      });

      // Click handler for genre items
      $item.on('click', (e) => {
        // If shift is held, toggle multi-select mode
        const isShiftClick = e.shiftKey;
        const genreName = $item.data('genre');
        const isAlreadySelected = this.activeGenres.has(genreName);

        // If clicking on an already selected genre in single-select mode, deselect it
        if (!isShiftClick && !this.genreMultiSelect && isAlreadySelected) {
          this.activeGenres.delete(genreName);
          $item.removeClass('active');
          $item.find('.genre-name').css('color', 'var(--text-2)');
          this.onFiltersChanged();
          return;
        }

        if (!isShiftClick && !this.genreMultiSelect) {
          // Single select mode - clear other selections
          this.activeGenres.clear();
          this.$genreList.find('.genre-item').removeClass('active');
          this.$genreList.find('.genre-name').css('color', 'var(--text-2)');
        }

        // Toggle this genre
        if (this.activeGenres.has(genreName)) {
          this.activeGenres.delete(genreName);
          $item.removeClass('active');
          $item.find('.genre-name').css('color', 'var(--text-2)');
        } else {
          this.activeGenres.add(genreName);
          $item.addClass('active');
          $item.find('.genre-name').css('color', 'var(--text)');
        }

        // Enable multi-select if we have more than one active genre
        this.genreMultiSelect = this.activeGenres.size > 1;

        this.onFiltersChanged();
      });

      this.$genreList.append($item);
    }
  }

  /**
   * Update counts for period items.
   */
  updatePeriodCounts() {
    const albums = Model.library.albums || [];
    const $periodItems = this.$periodList.find('.period-item');

    $periodItems.each((i, el) => {
      const $item = $(el);
      const start = parseInt($item.data('start')) || 0;
      const end = parseInt($item.data('end')) || 9999;

      const count = albums.filter(album => {
        const year = album.year;
        return year >= start && year <= end;
      }).length;

      $item.find('.period-count').text(count);
    });
  }

  /**
   * Initialize period filters click handlers.
   */
  initPeriodFilters() {
    const $periodItems = this.$periodList.find('.period-item');

    $periodItems.on('mouseenter', (e) => {
      const $item = $(e.currentTarget);
      if (!this.activePeriods.has($item[0])) {
        $item.find('.period-name').css('color', 'var(--text)');
      }
    });

    $periodItems.on('mouseleave', (e) => {
      const $item = $(e.currentTarget);
      if (!this.activePeriods.has($item[0])) {
        $item.find('.period-name').css('color', 'var(--text-2)');
      }
    });

    $periodItems.on('click', (e) => {
      const $item = $(e.currentTarget);
      const isShiftClick = e.shiftKey;
      const isAlreadySelected = this.activePeriods.has($item[0]);

      if (!isShiftClick && !this.periodMultiSelect && isAlreadySelected) {
        this.activePeriods.delete($item[0]);
        $item.removeClass('active');
        $item.find('.period-name').css('color', 'var(--text-2)');
        this.onFiltersChanged();
        return;
      }

      if (!isShiftClick && !this.periodMultiSelect) {
        this.activePeriods.clear();
        this.$periodList.find('.period-item').removeClass('active');
        this.$periodList.find('.period-name').css('color', 'var(--text-2)');
      }

      if (this.activePeriods.has($item[0])) {
        this.activePeriods.delete($item[0]);
        $item.removeClass('active');
        $item.find('.period-name').css('color', 'var(--text-2)');
      } else {
        this.activePeriods.add($item[0]);
        $item.addClass('active');
        $item.find('.period-name').css('color', 'var(--text)');
      }

      this.periodMultiSelect = this.activePeriods.size > 1;

      this.onFiltersChanged();
    });
  }

  /**
   * Reset all filters.
   */
  resetFilters() {
    // Clear format filters
    this.activeFormats.clear();
    this.$formatChips.removeClass('active');

    // Clear genre filters
    this.activeGenres.clear();
    this.$genreList.find('.genre-item').removeClass('active');
    this.$genreList.find('.genre-name').css('color', 'var(--text-2)');
    this.genreMultiSelect = false;

    // Clear period filters
    this.activePeriods.clear();
    this.$periodList.find('.period-item').removeClass('active');
    this.$periodList.find('.period-name').css('color', 'var(--text-2)');
    this.periodMultiSelect = false;

    // Reset browse to "All Albums"
    this.$browseItems.removeClass('active');
    this.$browseItems.filter('[data-filter="all-albums"]').addClass('active');
    this.browseFilter = 'all-albums';

    // Trigger filter change
    this.onFiltersChanged();
  }

  /**
   * Reset browse filter only.
   */
  resetBrowseFilter() {
    this.$browseItems.removeClass('active');
    this.$browseItems.filter('[data-filter="all-albums"]').addClass('active');
    this.browseFilter = 'all-albums';
    this.onFiltersChanged();
  }

  /**
   * Reset format filter only.
   */
  resetFormatFilter() {
    this.activeFormats.clear();
    this.$formatChips.removeClass('active');
    this.onFiltersChanged();
  }

  /**
   * Reset genre filter only.
   */
  resetGenreFilter() {
    this.activeGenres.clear();
    this.$genreList.find('.genre-item').removeClass('active');
    this.$genreList.find('.genre-name').css('color', 'var(--text-2)');
    this.genreMultiSelect = false;
    this.onFiltersChanged();
  }

  /**
   * Reset period filter only.
   */
  resetPeriodFilter() {
    this.activePeriods.clear();
    this.$periodList.find('.period-item').removeClass('active');
    this.$periodList.find('.period-name').css('color', 'var(--text-2)');
    this.periodMultiSelect = false;
    this.onFiltersChanged();
  }

  /**
   * Called when filters change.
   */
  onFiltersChanged() {
    // Update visibility of reset icons based on active filters
    this.updateResetIcons();

    // Trigger custom event that library-view can listen to
    $(document).trigger('sidebar-filters-changed', [this.getFilterState()]);
  }

  /**
   * Update visibility of reset icons based on active filters.
   */
  updateResetIcons() {
    // Browse reset icon - visible when not "all-albums"
    const $resetBrowse = $('#resetBrowse');
    if (this.browseFilter !== 'all-albums') {
      $resetBrowse.addClass('visible');
    } else {
      $resetBrowse.removeClass('visible');
    }

    // Format reset icon - visible when any format is selected
    const $resetFormat = $('#resetFormat');
    if (this.activeFormats.size > 0) {
      $resetFormat.addClass('visible');
    } else {
      $resetFormat.removeClass('visible');
    }

    // Genre reset icon - visible when any genre is selected
    const $resetGenre = $('#resetGenre');
    if (this.activeGenres.size > 0) {
      $resetGenre.addClass('visible');
    } else {
      $resetGenre.removeClass('visible');
    }

    // Period reset icon
    const $resetPeriod = $('#resetPeriod');
    if (this.activePeriods.size > 0) {
      $resetPeriod.addClass('visible');
    } else {
      $resetPeriod.removeClass('visible');
    }

    // Global reset icon
    const $resetFilters = $('#resetFilters');
    if (this.hasActiveFilters()) {
      $resetFilters.addClass('visible');
    } else {
      $resetFilters.removeClass('visible');
    }
  }

  /**
   * Get current filter state.
   */
  getFilterState() {
    // Collect active periods data
    const periods = Array.from(this.activePeriods).map(el => {
      const $el = $(el);
      return {
        start: parseInt($el.data('start')) || 0,
        end: parseInt($el.data('end')) || 9999
      };
    });

    return {
      formats: Array.from(this.activeFormats),
      genres: Array.from(this.activeGenres),
      periods: periods,
      browse: this.browseFilter,
      genreMultiSelect: this.genreMultiSelect,
      periodMultiSelect: this.periodMultiSelect
    };
  }

  /**
   * Check if any filters are active.
   */
  hasActiveFilters() {
    return this.activeFormats.size > 0 ||
      this.activeGenres.size > 0 ||
      this.activePeriods.size > 0 ||
      this.browseFilter !== 'all-albums';
  }

  /**
   * Escape HTML for safe insertion.
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Singleton
export default new SidebarView();