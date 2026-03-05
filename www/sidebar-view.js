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
  $topBar;
  isMobileSidebarMode = false;
  desktopCollapsedBeforeMobile = false;
  topBarResizeObserver = null;

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
    this.$topBar = $('#topBar');

    // Observe #page class changes to update toggle visibility (for view switches)
    if (window.MutationObserver) {
      const observer = new MutationObserver(() => {
        this.updateTogglePlacementForViewport();
      });
      observer.observe(this.$page.get(0), { attributes: true, attributeFilter: ['class'] });
    }

    // Wrap existing content in a scroll container so the toggle
    // can stay centered and not move with scroll.
    this.$scroll = $('<div class="sidebar-scroll"></div>');
    const $existingChildren = this.$el.children().detach();
    this.$scroll.append($existingChildren);
    this.$el.append(this.$scroll);

    // Collapse/expand toggle
    this.$toggle = $(`
      <button type="button" id="sidebarToggle" aria-label="Collapse sidebar" title="Hide sidebar">
        <svg class="sidebar-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9.29 6.71a1 1 0 0 1 1.42 0l4.59 4.59a1 1 0 0 1 0 1.41l-4.59 4.59a1 1 0 1 1-1.42-1.41L13.17 12 9.29 8.12a1 1 0 0 1 0-1.41z"></path>
        </svg>
      </button>
    `);
    this.$el.append(this.$toggle);
    this.$toggle.on('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleCollapsed();
    });
    this.syncToggleIcon();
    this.handleViewportChange = () => {
      this.updateTogglePlacementForViewport();
    };
    $(window).on('resize', this.handleViewportChange);
    this.updateTogglePlacementForViewport();

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

  updateTogglePlacementForViewport() {
    const isMobileViewport = window.matchMedia('(max-width: 768px)').matches;

    if (isMobileViewport && !this.isMobileSidebarMode) {
      this.isMobileSidebarMode = true;
      this.desktopCollapsedBeforeMobile = this.$page.hasClass('isSidebarCollapsed');
      this.$page.addClass('isSidebarCollapsed');
    } else if (!isMobileViewport && this.isMobileSidebarMode) {
      this.isMobileSidebarMode = false;
      this.$page.toggleClass('isSidebarCollapsed', this.desktopCollapsedBeforeMobile);
    }

    if (this.isMobileSidebarMode) {
      this.ensureTopBarObserver();
      const $topBar = $('#topBar');
      const isLibraryView = this.$page.hasClass('libraryView');
      if (isLibraryView) {
        if ($topBar.length > 0 && !this.$toggle.parent().is($topBar)) {
          $topBar.prepend(this.$toggle);
        }
        this.$toggle.addClass('isMobileToggle');
        this.$toggle.show();
      } else {
        this.$toggle.removeClass('isMobileToggle');
        this.$toggle.hide();
      }
    } else {
      this.disconnectTopBarObserver();
      if (!this.$toggle.parent().is(this.$el)) {
        this.$el.append(this.$toggle);
      }
      this.$toggle.removeClass('isMobileToggle');
      this.$toggle.show();
    }

    this.updateMobileSidebarTopOffset();
    this.syncToggleIcon();
  }

  ensureTopBarObserver() {
    if (!window.ResizeObserver || this.topBarResizeObserver || !this.$topBar || this.$topBar.length === 0) {
      return;
    }
    this.topBarResizeObserver = new ResizeObserver(() => {
      this.updateMobileSidebarTopOffset();
    });
    this.topBarResizeObserver.observe(this.$topBar.get(0));
  }

  disconnectTopBarObserver() {
    if (!this.topBarResizeObserver) {
      return;
    }
    this.topBarResizeObserver.disconnect();
    this.topBarResizeObserver = null;
  }

  updateMobileSidebarTopOffset() {
    if (!this.$page || this.$page.length === 0) {
      return;
    }

    if (this.isMobileSidebarMode && this.$topBar && this.$topBar.length > 0) {
      const topOffset = Math.round(this.$topBar.outerHeight() || 0);
      this.$page.css('--mobile-main-top', `${topOffset}px`);
      return;
    }

    this.$page.css('--mobile-main-top', '0px');
  }

  syncToggleIcon() {
    const isCollapsed = this.$page.hasClass('isSidebarCollapsed');
    this.$toggle.toggleClass('isCollapsed', isCollapsed);
    const isMobile = this.isMobileSidebarMode;
    if (isCollapsed) {
      this.$toggle.attr('aria-label', isMobile ? 'Open filters' : 'Expand sidebar');
      this.$toggle.attr('title', isMobile ? 'Show filters' : 'Show sidebar');
    } else {
      this.$toggle.attr('aria-label', isMobile ? 'Close filters' : 'Collapse sidebar');
      this.$toggle.attr('title', isMobile ? 'Hide filters' : 'Hide sidebar');
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

    $periodItems.on('click', (e) => {
      const $item = $(e.currentTarget);
      const isShiftClick = e.shiftKey;
      const isAlreadySelected = this.activePeriods.has($item[0]);

      if (!isShiftClick && !this.periodMultiSelect && isAlreadySelected) {
        this.activePeriods.delete($item[0]);
        $item.removeClass('active');
        this.onFiltersChanged();
        return;
      }

      if (!isShiftClick && !this.periodMultiSelect) {
        this.activePeriods.clear();
        this.$periodList.find('.period-item').removeClass('active');
      }

      if (this.activePeriods.has($item[0])) {
        this.activePeriods.delete($item[0]);
        $item.removeClass('active');
      } else {
        this.activePeriods.add($item[0]);
        $item.addClass('active');
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