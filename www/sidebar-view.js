import AppUtil from './app-util.js';
import Model from './model.js';
import Settings from './settings.js';
import Util from './util.js';
import ViewUtil from './view-util.js';

/**
 * Sidebar view for filtering albums.
 */
class SidebarView {

  $el;
  $resetButton;
  $formatChips;
  $genreList;
  $browseItems;

  // Filter state
  activeFormats = new Set();
  activeGenres = new Set();
  browseFilter = 'all-albums'; // 'all-albums', 'favorite-albums', 'favorite-tracks'
  genreMultiSelect = false;

  constructor() {
    this.$el = $('#sidebar');
    this.$resetButton = $('#resetFilters');
    this.$formatChips = this.$el.find('.fchip');
    this.$genreList = $('#genreList');
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
    
    // Listen for library updates to populate genre list
    Util.addAppListener(this, 'model-library-updated', this.onModelLibraryUpdated);
    
    // Initial population
    if (Model.library && Model.library.albums) {
      this.onModelLibraryUpdated();
    }
    
    // Set initial active state for "All Albums"
    this.$browseItems.filter('[data-filter="all-albums"]').addClass('active');
  }

  /**
   * Called when model library is updated.
   */
  onModelLibraryUpdated() {
    this.updateCounts();
    this.populateGenreList();
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
      return window.hqpwv && window.hqpwv.MetaUtil && window.hqpwv.MetaUtil.isAlbumFavoriteFor(albumHash);
    });
    $('#countFavoriteAlbums').text(favoriteAlbums.length);
    
    // Favorite tracks count - need to count from meta
    let favoriteTrackCount = 0;
    if (window.hqpwv && window.hqpwv.MetaUtil && window.hqpwv.MetaUtil.getFavoriteTrackCount) {
      favoriteTrackCount = window.hqpwv.MetaUtil.getFavoriteTrackCount();
    }
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
          <div class="genre-checkbox"></div>
          <span class="genre-name">${this.escapeHtml(genre)}</span>
          <span class="genre-count">${count}</span>
        </div>
      `);
      
      // Click handler for genre items
      $item.on('click', (e) => {
        // If shift is held, toggle multi-select mode
        const isShiftClick = e.shiftKey;
        
        if (!isShiftClick && !this.genreMultiSelect) {
          // Single select mode - clear other selections
          this.activeGenres.clear();
          this.$genreList.find('.genre-item').removeClass('active');
        }
        
        // Toggle this genre
        const genreName = $item.data('genre');
        if (this.activeGenres.has(genreName)) {
          this.activeGenres.delete(genreName);
          $item.removeClass('active');
        } else {
          this.activeGenres.add(genreName);
          $item.addClass('active');
        }
        
        // Enable multi-select if we have more than one active genre
        this.genreMultiSelect = this.activeGenres.size > 1;
        
        this.onFiltersChanged();
      });
      
      this.$genreList.append($item);
    }
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
    this.genreMultiSelect = false;
    
    // Reset browse to "All Albums"
    this.$browseItems.removeClass('active');
    this.$browseItems.filter('[data-filter="all-albums"]').addClass('active');
    this.browseFilter = 'all-albums';
    
    // Trigger filter change
    this.onFiltersChanged();
  }

  /**
   * Called when filters change.
   */
  onFiltersChanged() {
    // Trigger custom event that library-view can listen to
    $(document).trigger('sidebar-filters-changed', [this.getFilterState()]);
  }

  /**
   * Get current filter state.
   */
  getFilterState() {
    return {
      formats: Array.from(this.activeFormats),
      genres: Array.from(this.activeGenres),
      browse: this.browseFilter,
      genreMultiSelect: this.genreMultiSelect
    };
  }

  /**
   * Check if any filters are active.
   */
  hasActiveFilters() {
    return this.activeFormats.size > 0 || 
           this.activeGenres.size > 0 || 
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