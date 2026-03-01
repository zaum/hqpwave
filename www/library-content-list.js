import AlbumUtil from './album-util.js';
import AppUtil from './app-util.js';
import Commands from './commands.js';
import DataUtil from './data-util.js';
import GroupLabelUtil from './group-label-util.js';
import LibraryGroupUtil from './library-group-util.js';
import MetaUtil from './meta-util.js';
import Model from './model.js';
import Settings from './settings.js';
import ViewUtil from './view-util.js';

/**
 * 'Abstract' base class for the two content views of LibraryView.
 *
 * Has albums array. And groups/labels arrays (which would be dependent on albums).
 *
 * Subclass must provide enough logic for `populateDom()` to work, basically.
 */
export default class LibraryContentList {

  $el;

  albums;
  labels;
  groups;

  intersectionObs;
  preloadedImageUrls;

  constructor($el) {
    this.$el = $el;
    this.preloadedImageUrls = new Set();
    const config = { root: $('#libraryView')[0], rootMargin: (window.screen.height * 0.66) + 'px', threshold: 0 };
    this.intersectionObs = new IntersectionObserver(this.onIntersection, config);
    $(document).on('album-favorite-changed', this.onAlbumFavoriteChanged);
    $(document).on('settings-show-play-button-changed settings-show-format-overlay-changed', this.onSettingsChanged);
  }

  show(type = null, value = null) {
    ViewUtil.setDisplayed(this.$el, true);
  }

  hide() {
    ViewUtil.setDisplayed(this.$el, false);
  }

  /**
   * Sets the albums array.
   * 'Abstract'
   */
  setAlbums(albums) { }

  /** 'Abstract' */
  get groupCssClass() { }

  /** 'Abstract' */
  get labelCssClass() { }

  /**
   * Returns a list item DOM element
   * 'Abstract'
   */
  makeListItem(data, index) { }

  /**
   * Removes all children, plus cleanup.
   */
  clear() {
    this.intersectionObs.disconnect();
    this.preloadedImageUrls.clear();
    this.$el.empty();
  }

  /**
   * Populates dom.
   */
  populateDom() {
    this.clear();

    const isLibraryEmpty = (Model.library.albums.length == 0);
    if (isLibraryEmpty) {
      const $item = LibraryContentList.makeLibraryIsEmptyItem();
      this.$el.append($item);
      return;
    }
    const isEmpty = (this.albums.length == 0) || (this.groups.length == 0)
      || (this.groups.length == 1 && this.groups[0].length == 0);
    if (isEmpty) {
      const $item = LibraryContentList.makeListIsEmptyItem();
      this.$el.append($item);
      return;
    }

    // No grouping - just render all albums in a single grid
    const $group = $(`<div class="${this.groupCssClass}"></div>`);
    for (let i = 0; i < this.groups.length; i++) {
      const group = this.groups[i];
      this.populateGroupDiv($group, group);
    }
    this.$el.append($group);
    
    // Update play button visibility based on setting
    this.updateOverlayVisibility();
    this.primeInitialPreload();
  }

  // override-able
  populateGroupDiv($group, array) {
    for (let i = 0; i < array.length; i++) {
      const item = array[i];
      const $item = this.makeListItem(item, i);
      $item.on("click tap", e => this.onItemClick(e));
      $item.on("keydown", this.onItemKeydown);
      const img = $item.find('img')[0];
      if (img) {
        this.intersectionObs.observe(img);
      }
      $group.append($item);
    }
  }

  get areAllLabelsExpanded() {
    const $labels = this.$el.find('.libraryGroupLabel');
    if ($labels.length == 0) {
      return null;
    }
    for (const label of $labels) {
      const isCollapsed = $(label).hasClass('isCollapsed');
      if (isCollapsed) {
        return false;
      }
    }
    return true;
  }

  get areAllLabelsCollapsed() {
    const $labels = this.$el.find('.libraryGroupLabel');
    if ($labels.length == 0) {
      return null;
    }
    for (const label of $labels) {
      const isCollapsed = $(label).hasClass('isCollapsed');
      if (!isCollapsed) {
        return false;
      }
    }
    return true;
  }

  expandAllGroups() {
    const $labels = this.$el.find('.libraryGroupLabel');
    const $groups = this.$el.find('.libraryAlbumGroup');
    $labels.removeClass('isCollapsed');
    $groups.removeClass('isCollapsed');

    const keys = [];
    for (const label of $labels) {
      keys.push(label.getAttribute('data-collapsekey'));
    }
    Settings.setLibraryGroupsCollapsed(keys, false);
  }

  collapseAllGroups() {
    const $labels = this.$el.find('.libraryGroupLabel');
    const $groups = this.$el.find('.libraryAlbumGroup');
    $labels.addClass('isCollapsed');
    $groups.addClass('isCollapsed');

    const keys = [];
    for (const label of $labels) {
      keys.push(label.getAttribute('data-collapsekey'));
    }
    Settings.setLibraryGroupsCollapsed(keys, true);
  }

  static makeLibraryIsEmptyItem() {
    let s;
    s = `<div id="libraryNoneItem" class="libraryItem">`;
    s += `<span class="colorAccent">Library is empty.</span><br><br>`;
    s += `<span class="colorTextLess">Add music to your HQPlayer library<br>`;
    s += `<em>(HQPlayer > File > Library...)</em><br>`;
    s += `and reload page.</span>`;
    s += `</div>`;
    return $(s);
  }

  static makeListIsEmptyItem() {
    const s = `<div class="libraryItem" id="libraryNoneItem">No items</div>`;
    return $(s);
  }

  /**
   * Has special logic to fade in visible images on first batch only.
   */
  onIntersection = (entries, self) => {

    for (const entry of entries) {
      const $img = $(entry.target);
      if (entry.isIntersecting) {
        const src = $img.attr('data-src');
        if (src && $img.attr('src') !== src) {
          $img.attr('src', src);
        }
        this.preloadNearbyImages(entry.target);
      }
    }
  };

  preloadNearbyImages(imgEl) {
    const $imgs = this.$el.find('.libraryItemPicture img[data-src]');
    const currentIndex = $imgs.index(imgEl);
    if (currentIndex < 0) {
      return;
    }

    const preloadAheadCount = 24;
    const preloadBehindCount = 4;
    const maxIndex = $imgs.length - 1;

    for (let i = currentIndex + 1; i <= Math.min(maxIndex, currentIndex + preloadAheadCount); i++) {
      const src = $($imgs[i]).attr('data-src');
      this.preloadImage(src);
    }
    for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - preloadBehindCount); i--) {
      const src = $($imgs[i]).attr('data-src');
      this.preloadImage(src);
    }
  }

  preloadImage(src) {
    if (!src || this.preloadedImageUrls.has(src)) {
      return;
    }
    this.preloadedImageUrls.add(src);
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  }

  primeInitialPreload() {
    const $imgs = this.$el.find('.libraryItemPicture img[data-src]');
    const max = Math.min($imgs.length, 36);
    for (let i = 0; i < max; i++) {
      const src = $($imgs[i]).attr('data-src');
      this.preloadImage(src);
    }
  }

  // override-able
  onItemClick(event) {
    const $item = $(event.currentTarget);
    let album = $item.data('album');
    if (!album) {
      const hash = $item.attr("data-hash");
      album = Model.library.getAlbumByAlbumHash(hash);
    }
    if (!album) {
      cl('warning album item click has no resolved album');
      return;
    }
    $(document).trigger('library-item-click', [album, $item]);
  };

  onItemKeydown = (event) => {
    if (event.keyCode == 13) {
      this.onItemClick(event);
    }
  };

  onAlbumFavoriteChanged = (event, hash, isFavorite) => {
    const selector = `[data-hash="${hash}"]`;
    const $item = this.$el.find(selector);
    if ($item.length > 0) {
      if (isFavorite) {
        $item.addClass('isFavorite');
      } else {
        $item.removeClass('isFavorite');
      }
    }
  };

  /**
   * Standard rect-shaped list item for an album,
   * used for most of the library view lists.
   */
  static makeAlbumListItem(album) {
    const hash = album['@_hash'];
    const imgPath = DataUtil.getAlbumImageUrl(album);
    const artist = album['@_artist'];
    const albumText = album['@_album'];
    const bits = AlbumUtil.getBitrateText(album);
    const isFavoriteClass = MetaUtil.isAlbumFavoriteFor(hash) ? 'isFavorite' : '';
    // Invert the logic to fix the backwards toggle
    const showPlayButton = !Settings.showPlayButton;
    const showFormatOverlay = Settings.showFormatOverlay;

    let s = `<div class="libraryItem ${isFavoriteClass}" data-hash="${hash}">`; /* tabindex="0" */
    s += `<div class="libraryItemPicture">
                 <img data-src="${imgPath}" />
                 ${showPlayButton ? `` : `<div class="libraryItemPlayBtn" title="Play Album">
                   <svg viewBox="0 0 24 24" fill="currentColor">
                     <path d="M8 5v14l11-7z"/>
                   </svg>
                 </div>`}
                 <div class="libraryItemBits">${bits}</div>
               </div>`;
    s += `<div class="libraryItemTexts">
                  <div class="libraryItemFavorite"></div>
                  <div class="libraryItemText1">${artist}</div>
                  <div class="libraryItemText2">${albumText}</div>
                </div>`;
    s += `</div>`;
    const $item = $(s);
    $item.data('album', album);

    if (!showPlayButton) {
      $item.addClass('show-play-button');
      $item.find('.libraryItemPlayBtn').on('click tap', (e) => {
        e.stopPropagation();
        const commands = Commands.playlistAddUsingAlbumAndIndices(album, 0, -1);
        AppUtil.doPlaylistAdds(commands, true, true);
      });
    } else {
      $item.removeClass('show-play-button');
    }

    if (showFormatOverlay) {
      $item.addClass('show-format-overlay');
    } else {
      $item.removeClass('show-format-overlay');
    }

    return $item;
  }

  updateOverlayVisibility() {
    // Invert the logic to fix the backwards toggle
    const showPlayButton = !Settings.showPlayButton;
    const showFormatOverlay = Settings.showFormatOverlay;
    const $items = this.$el.find('.libraryItem');
    
    $items.each((index, item) => {
      const $item = $(item);
      if (!showPlayButton) {
        $item.addClass('show-play-button');
      } else {
        $item.removeClass('show-play-button');
      }

      if (showFormatOverlay) {
        $item.addClass('show-format-overlay');
      } else {
        $item.removeClass('show-format-overlay');
      }
    });
  }

  onSettingsChanged = () => {
    // Update all existing items in the library view
    this.updateOverlayVisibility();
  }
}
