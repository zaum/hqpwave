// Timeline minimap rendering and interaction for group by year view
window.renderTimelineMinimap = function (years) {
  const $container = $('#timelineMinimapContainer');
  const $minimap = $('#timelineMinimap');
  $minimap.empty();
  $minimap.css('display', 'block');
  if (!years || years.length === 0) return;

  const firstYear = years[0];
  const lastYear = years[years.length - 1];

  // Add top label (clickable)
  const $topLabel = $(`<div class="minimapYearLabel" style="top: 0;">${firstYear}</div>`);
  $topLabel.on('click', function (e) {
    e.stopPropagation(); // Prevent container click
    scrollToYear(firstYear);
  });
  $minimap.append($topLabel);

  // Minimap line
  const $line = $('<div class="minimapLine"></div>');
  $minimap.append($line);

  // Add bottom label (clickable)
  const $bottomLabel = $(`<div class="minimapYearLabel" style="bottom: 0;">${lastYear}</div>`);
  $bottomLabel.on('click', function (e) {
    e.stopPropagation(); // Prevent container click
    scrollToYear(lastYear);
  });
  $minimap.append($bottomLabel);

  // Add dot
  const $dot = $('<div class="minimapDot"></div>');
  $minimap.append($dot);

  // Helper function to scroll to year
  function scrollToYear(year) {
    const container = document.getElementById('libraryView');
    if (window._yearPositions) {
      const pos = window._yearPositions.find(p => p.year === year);
      if (pos) {
        container.scrollTop = pos.top;
        return;
      }
    }
    const $group = $(`.libraryGroupLabel.year:contains('${year}')`).first();
    if ($group.length) {
      container.scrollTop = $group[0].offsetTop;
    }
  }

  // Store for scroll sync
  window._timelineYears = years;
  window._timelineDot = $dot;
  window._timelineLine = $line;
  window._timelineContainer = $container;

  // Click on the entire container width
  $container.off('click').on('click', function (e) {
    const scrollContainer = document.getElementById('libraryView');
    if (!scrollContainer) return;

    // Use $minimap for inner dimensions (same as dot positioning)
    const minimapRect = ViewUtil.getRect($minimap[0], (newRect) => {
      // nothing to cache here; future clicks will measure fresh, but if
      // the rect changed after load we don't need to mutate other state now.
    });
    const containerRect = ViewUtil.getRect($container[0], (newRect) => {});

    // Get click position relative to minimap
    const y = e.clientY - minimapRect.top;
    const height = minimapRect.height;

    // Apply the same margin logic as dot positioning (50px)
    const margin = 50;
    const dotSize = 14;
    const availableHeight = height - dotSize - (margin * 2);

    // Adjust y to account for margin
    const adjustedY = y - margin;
    const percent = Math.max(0, Math.min(1, adjustedY / availableHeight));

    // Scroll to the calculated percent position
    const scrollHeight = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    scrollContainer.scrollTop = percent * scrollHeight;
  });

  // Sync dot position on scroll
  const scrollContainer = document.getElementById('libraryView');
  if (scrollContainer) {
    scrollContainer.onscroll = function () {
      window.updateTimelineDot();
    };
    window.updateTimelineDot();
  }

  // Make dot draggable
  window.makeTimelineDotDraggable();
};

window.updateTimelineDot = function () {
  const years = window._timelineYears;
  const $dot = window._timelineDot;
  const $container = $('#timelineMinimap');
  if (!years || !$dot || !$container) return;
  const scrollContainer = document.getElementById('libraryView');
  if (!scrollContainer) return;

  // Get scroll progress (0 to 1)
  const scrollHeight = scrollContainer.scrollHeight - scrollContainer.clientHeight;
  const scrollProgress = scrollHeight > 0 ? scrollContainer.scrollTop / scrollHeight : 0;

  // Get container height and dot size
  const containerHeight = $container.height();
  const dotSize = 14;
  const margin = 50; // Same as CSS top/bottom on .minimapLine

  // Position dot based on scroll progress, accounting for margins
  const availableHeight = containerHeight - dotSize - (margin * 2);
  const dotTop = margin + (scrollProgress * availableHeight);
  $dot.css('top', `${Math.max(margin, Math.min(containerHeight - dotSize - margin, dotTop))}px`);
};

// Make timeline dot draggable (mouse and touch)
window.makeTimelineDotDraggable = function () {
  const $dot = window._timelineDot;
  const $container = $('#timelineMinimap');
  if (!$dot || !$container) return;

  let isDragging = false;
  let startPercent = 0;
  let startClientY = 0;

  // Helper function to handle drag start
  function startDrag(clientY) {
    isDragging = true;
    startClientY = clientY;

    const scrollContainer = document.getElementById('libraryView');
    if (scrollContainer) {
      const scrollHeight = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      startPercent = scrollHeight > 0 ? scrollContainer.scrollTop / scrollHeight : 0;
    }
  }

  // Helper function to handle drag move
  function moveDrag(clientY) {
    if (!isDragging) return;

    const scrollContainer = document.getElementById('libraryView');
    if (!scrollContainer) return;

    const containerRect = $container[0].getBoundingClientRect();
    const containerHeight = containerRect.height;
    const dotSize = 14;
    const margin = 50;
    const availableHeight = containerHeight - dotSize - (margin * 2);

    // Calculate delta from start position
    const deltaY = clientY - startClientY;
    const deltaPercent = deltaY / availableHeight;

    // Apply delta to start percent
    let newPercent = startPercent + deltaPercent;
    newPercent = Math.max(0, Math.min(1, newPercent));

    // Scroll to position
    const scrollHeight = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    scrollContainer.scrollTop = newPercent * scrollHeight;
  }

  // Helper function to handle drag end
  function endDrag() {
    isDragging = false;
  }

  // Mouse events
  $dot.on('mousedown', function (e) {
    startDrag(e.clientY);
    e.preventDefault();
    e.stopPropagation();
  });

  $(document).on('mousemove', function (e) {
    moveDrag(e.clientY);
  });

  $(document).on('mouseup', function () {
    endDrag();
  });

  // Touch events
  $dot.on('touchstart', function (e) {
    const touch = e.touches[0];
    startDrag(touch.clientY);
    e.preventDefault();
    e.stopPropagation();
  });

  $(document).on('touchmove', function (e) {
    const touch = e.touches[0];
    moveDrag(touch.clientY);
    e.preventDefault();
  });

  $(document).on('touchend', function () {
    endDrag();
  });
};
import AlbumView from './album-view.js';
import AppUtil from './app-util.js';
import Busyer from './busyer.js';
import Commands from './commands.js';
import DialogView from './dialog-view.js';
import FullAlbumOverlay from './full-album-overlay.js';
import HqpConfigModel from './hqp-config-model.js';
import HqpSettingsView from './hqp-settings-view.js';
import LibraryView from './library-view.js';
import MetaUtil from './meta-util.js';
import Model from './model.js';
import DataUtil from './data-util.js';
import Native from './native.js';
import PlaybarView from './playbar-view.js';
import PlaylistCompoundView from './playlist-compound-view.js';
import PresetRuleApplier from './preset-rule-applier.js';
import Service from './service.js';
import Settings from './settings.js';
import SettingsView from './settings-view.js';
import SnackView from './snack-view.js';
import Statuser from './statuser.js';
import ToastView from './toast-view.js';
import TopBar from './top-bar.js';
import TopBarUtil from './top-bar-util.js';
import Util from './util.js';
import Values from './values.js';
import ViewTransition from './view-transition.js';
import ViewUtil from './view-util.js';
import SidebarView from './sidebar-view.js';

/**
 * Main class.
 * Instantiation runs the app.
 * `document` must already be `ready`.
 */
export default class App {

  static instance;

  playbarView = new PlaybarView();
  libraryView = new LibraryView();
  albumView = new AlbumView();
  playlistView = new PlaylistCompoundView();
  settingsView = new SettingsView();
  hqpSettingsView = new HqpSettingsView();
  subviews = [this.libraryView, this.albumView, this.playlistView, this.settingsView, this.hqpSettingsView];

  sidebarView = SidebarView;

  $pageHolder = $('#page');
  $settingsButton = $('#settingsButton');
  $hqpSettingsButton = $('#hqpSettingsButton');
  $brandLogo = $('#brandLogo');
  $navPills = $('.nav-pill');

  instanceId = Math.floor(Math.random() * 99999999);
  lastKeyTime = 0;
  minKeyDuration = 350;
  resizeTimeoutId = 0;
  subviewZ = 100;
  transitionDurationMs = 350;
  metaRetryTimeoutId = 0;
  metaRetryCount = 0;
  metaRetryMax = 3;
  isBrandLogoAnimationRunning = false;
  brandLogoAnimationCooldownUntil = 0;

  constructor() {
    if (Util.isTouch) {
      $('html').addClass('isTouch');
    }
    AppUtil.updateColorTheme();
    // Initialize accent color CSS variables
    AppUtil.updateAccentColorCSS(Settings.highlightColor);
    // Initialize player background color
    document.documentElement.style.setProperty('--player-bg', Settings.playerBackgroundColor);
    ViewUtil.setVisible($('html'), true);

    $(window).on('resize', this.onWindowResize);
    this.doWindowResize();

    // Initialize topbar navigation
    this.initTopbarNav();

    Util.addAppListener(this, 'disable-user-input', this.onDisableUserInput);
    Util.addAppListener(this, 'enable-user-input', this.onUndisableUserInput);
    Util.addAppListener(this, 'busy-start', this.updateBusyClass);
    Util.addAppListener(this, 'busy-end', this.updateBusyClass);
    Util.addAppListener(this, 'model-playlist-updated', this.updateMostStateClasses);
    Util.addAppListener(this, 'model-status-updated', () => { this.playbarView.update(); this.updateMostStateClasses(); });
    Util.addAppListener(this, 'meta-load-result', this.onMetaLoadResult);
    Util.addAppListener(this, 'proxy-errors', this.showHqpDisconnectedSnack);
    Util.addAppListener(this, 'server-errors', this.showServerErrorsSnack);
    Util.addAppListener(this, 'service-response-handled', this.onServiceResponseHandled);
    Util.addAppListener(this, 'settings-show-logo-animation-changed', this.onShowLogoAnimationChanged);

    Util.addAppListener(this, 'library-item-click', this.showAlbumView);
    Util.addAppListener(this, 'album-view-close-button', this.hideAlbumView);
    Util.addAppListener(this, 'album-genre-button', this.onAlbumGenreButton);
    Util.addAppListener(this, 'album-artist-button', this.onAlbumArtistButton);
    Util.addAppListener(this, 'playbar-show-playlist', this.togglePlaylistCompoundView);
    Util.addAppListener(this, 'playlist-close-button', this.hidePlaylist);
    Util.addAppListener(this, 'track-album-button-click', this.trackListItemToAlbum);
    Util.addAppListener(this, 'settings-view-close', this.hideSettingsView);
    Util.addAppListener(this, 'hqp-settings-view-close', this.hideHqpSettingsView);
    Util.addAppListener(this, 'app-do-escape', this.doEscape);
    Util.addAppListener(this, 'global-search-enter', this.onGlobalSearchEnter);

    $(document).on('keydown', this.onKeydown);

    this.$settingsButton.on('click', () => {
      if (ViewUtil.isVisible(this.settingsView.$el)) {
        this.goToLibraryView();
        return;
      }
      if (ViewUtil.isVisible(this.hqpSettingsView.$el)) {
        this.switchSettingsSubview(this.hqpSettingsView, this.settingsView);
        return;
      }
      this.showSettingsView();
    });
    this.$hqpSettingsButton.on('click', () => {
      if (ViewUtil.isVisible(this.hqpSettingsView.$el)) {
        this.goToLibraryView();
        return;
      }
      if (ViewUtil.isVisible(this.settingsView.$el)) {
        this.switchSettingsSubview(this.settingsView, this.hqpSettingsView);
        return;
      }
      this.showHqpSettingsView();
    });
    this.$brandLogo.on('click', () => {
      this.setActiveNavPill('library');
      this.goToLibraryView();
    });
    this.$brandLogo.off('.brandLogoAnim');
    this.$brandLogo.on('mouseenter.brandLogoAnim', () => {
      this.triggerBrandLogoAnimation();
    });
    this.$brandLogo.on('animationend.brandLogoAnim', '.brand-logo-mark-stroke', () => {
      this.isBrandLogoAnimationRunning = false;
      this.brandLogoAnimationCooldownUntil = Date.now() + 250;
      this.$brandLogo.removeClass('isStrokeAnimating');
    });
    this.$brandLogo.on('animationcancel.brandLogoAnim', '.brand-logo-mark-stroke', () => {
      this.isBrandLogoAnimationRunning = false;
      this.brandLogoAnimationCooldownUntil = Date.now() + 250;
      this.$brandLogo.removeClass('isStrokeAnimating');
    });
    this.updateBrandLogoAnimationState();
    setTimeout(() => this.triggerBrandLogoAnimation(), 180);
    $("#appTitle").on("click", () => this.doAppTitleClick());
    $('#backToLibraryButton').on('click', () => this.goToLibraryView());

    App.instance = this; // yes really

    this.updateMostStateClasses();

    // Make the correct things visible
    for (let subview of this.subviews) {
      ViewUtil.setVisible(subview.$el, false);
    }
    this.libraryView.show();
    this.updatePageHolderSubviewClass(this.libraryView);
    ViewUtil.setVisible(this.playbarView.$el, true);

    PresetRuleApplier.noop();
    FullAlbumOverlay.noop();

    this.init();
  }

  triggerBrandLogoAnimation() {
    if (!Settings.showLogoAnimation) {
      return;
    }
    const now = Date.now();
    if (this.isBrandLogoAnimationRunning || now < this.brandLogoAnimationCooldownUntil) {
      return;
    }
    this.isBrandLogoAnimationRunning = true;
    this.$brandLogo.addClass('isStrokeAnimating');
  }

  updateBrandLogoAnimationState() {
    if (Settings.showLogoAnimation) {
      return;
    }

    this.isBrandLogoAnimationRunning = false;
    this.$brandLogo.removeClass('isStrokeAnimating');
  }

  onShowLogoAnimationChanged = () => {
    this.updateBrandLogoAnimationState();
  }

  /**
   * Initialize topbar navigation.
   */
  initTopbarNav() {
    this.$navPills.on('click', (e) => {
      const $pill = $(e.currentTarget);
      const view = $pill.data('view');

      switch (view) {
        case 'library':
          this.setActiveNavPill('library');
          this.goToLibraryView();
          break;
        case 'album':
          this.hideSettingsViews(true);
          this.showCurrentAlbum();
          break;
        case 'playlist':
          this.setActiveNavPill('playlist');
          this.hideSettingsViews(true);
          this.showPlaylistCompoundView();
          break;
        case 'history':
          this.setActiveNavPill('history');
          this.hideSettingsViews(true);
          this.showHistoryView();
          break;
        case 'timeline':
        case 'artist':
          this.setActiveNavPill('library');
          this.goToLibraryView();
          break;
      }
    });
  }

  setActiveNavPill(view) {
    // Remove all nav-pill and iconButton highlights
    this.$navPills.removeClass('active');
    this.$settingsButton.removeClass('active');
    this.$hqpSettingsButton.removeClass('active');

    // Acute kiemelés logika
    if (view === 'settings') {
      this.$settingsButton.addClass('active');
    } else if (view === 'hqpSettings') {
      this.$hqpSettingsButton.addClass('active');
    } else {
      this.$navPills.filter(`[data-view="${view}"]`).addClass('active');
    }
  }

  hideSettingsViews(isDirect = false) {
    if (ViewUtil.isVisible(this.settingsView.$el)) {
      if (isDirect) {
        this.settingsView.hide();
      } else {
        this.hideSettingsView();
      }
    }
    if (ViewUtil.isVisible(this.hqpSettingsView.$el)) {
      if (isDirect) {
        this.hqpSettingsView.hide();
      } else {
        this.hideHqpSettingsView();
      }
    }
  }

  /**
   * Run a view transition through the overlay.
   * swapFn is called when the overlay is fully opaque.
   */
  transition(swapFn) {
    $(document).trigger('disable-user-input');
    ViewTransition.run(() => {
      swapFn();
      $(document).trigger('enable-user-input');
    }, this.transitionDurationMs);
  }

  goToLibraryView() {
    this.transition(() => {
      const closables = [this.hqpSettingsView, this.settingsView, this.playlistView, this.albumView];
      for (let subview of closables) {
        if (ViewUtil.isVisible(subview.$el)) {
          subview.hide();
        }
      }

      ViewUtil.setVisible(this.libraryView.$el, true);
      this.libraryView.$el.css('opacity', 1);
      this.updatePageHolderSubviewClass(this.libraryView);
      TopBarUtil.returnSubviewHeader(true);
      TopBarUtil.updateFor(this.libraryView.$el, true);
      ViewUtil.setFocus(this.libraryView.$el);
      this.setActiveNavPill('library');
      if (this.libraryView?.albumsList?.updateOverlayVisibility) {
        this.libraryView.albumsList.updateOverlayVisibility();
      }
    });
  }

  /**
   * Show history view.
   */
  showHistoryView() {
    this.playlistView.showSubview("history");
  }

  /**
   * Show currently playing album.
   */
  showCurrentAlbum() {
    const album = this.getCurrentAlbum();
    if (album) {
      this.showAlbumView(album);
      return;
    }

    if (ViewUtil.isVisible(this.albumView.$el)) {
      this.setActiveNavPill('album');
      return;
    }

    ToastView.show('No album currently playing');
  }

  getCurrentAlbum() {
    const meta = Model.status?.metadata || {};
    const uri = meta['@_uri'];
    if (uri && Model.hasLibrary) {
      const fromStatus = Model.library.getAlbumByTrackUri(uri);
      if (fromStatus) {
        return fromStatus;
      }
    }

    const currentIndex = Model.playlist?.currentIndex;
    const hasCurrentTrack = Number.isInteger(currentIndex)
      && currentIndex >= 0
      && currentIndex < (Model.playlist?.array?.length || 0);
    if (!hasCurrentTrack) {
      return null;
    }

    const currentTrack = Model.playlist.array[currentIndex];
    if (currentTrack?.album) {
      return currentTrack.album;
    }

    const trackUri = currentTrack?.['@_uri'];
    if (trackUri && Model.hasLibrary) {
      return Model.library.getAlbumByTrackUri(trackUri) || null;
    }

    return null;
  }

  /** Performs a series of required asynchronous calls. */
  init() {
    this.libraryView.setSpinnerState(true);

    // These are done in parallel to the hqp service calls
    Native.getInfo(this.instanceId, (data) => {
      Values.setValues(data);
    });
    MetaUtil.init();

    const step3 = (data) => {
      if (data.error != undefined) {
        this.showFatalError(data.error);
        return;
      }
      const duration = new Date().getTime() - startTime;
      cl(`init - async calls ${duration}ms`);
      this.updateMetaEnabledClass();
      this.libraryView.showFirstTime();
    };

    const step2 = () => {
      Statuser.start(); // calls Status
      Service.queueCommandsFront([
        { xml: Commands.state() },
        { xml: Commands.playlistGet() },
        { xml: Commands.libraryGet(), callback: step3 }
      ])
    };

    // step1
    const startTime = new Date().getTime();
    HqpConfigModel.updateData(step2);
  };

  // ---
  // subview concrete show/hide logic

  togglePlaylistCompoundView() {
    if (this.isPlaylistViewUsable()) {
      this.hidePlaylist();
    } else {
      this.showPlaylistCompoundView();
    }
  }

  showPlaylistCompoundView() {
    if (ViewUtil.isVisible(this.playlistView.$el) && !this.isPlaylistViewUsable()) {
      this.resetStalePlaylistViewState();
    }
    this.showSubview(this.playlistView);
    this.playlistView.showSubview("playlist");
    Service.queueCommandFront(Commands.playlistGet());
  }

  isPlaylistViewUsable() {
    if (!ViewUtil.isVisible(this.playlistView.$el)) {
      return false;
    }

    const opacity = parseFloat(this.playlistView.$el.css('opacity'));
    if (Number.isFinite(opacity) && opacity < 0.05) {
      return false;
    }

    return ViewUtil.isVisible(this.playlistView.mainView.$el)
      || ViewUtil.isVisible(this.playlistView.historyView.$el)
      || ViewUtil.isVisible(this.playlistView.loadView.$el);
  }

  resetStalePlaylistViewState() {
    this.playlistView.$el.css('opacity', 1);
    this.playlistView.$el.css('filter', 'brightness(1)');

    ViewUtil.setVisible(this.playlistView.mainView.$el, false);
    ViewUtil.setVisible(this.playlistView.historyView.$el, false);
    ViewUtil.setVisible(this.playlistView.loadView.$el, false);
    ViewUtil.setVisible(this.playlistView.$el, false);
  }

  trackListItemToAlbum(album) {
    ViewUtil.setVisible(this.albumView.$el, false);
    this.playlistView.hide();
    setTimeout(() => this.showAlbumView(album), 200);
  }

  showAlbumView(album, $libraryItem) {
    this.setActiveNavPill('album');
    this.showSubview(this.albumView, album, $libraryItem);
  }

  showSettingsView() {
    this.showSubview(this.settingsView);
    this.setActiveNavPill('settings');
  }

  showHqpSettingsView() {
    this.showSubview(this.hqpSettingsView);
    this.setActiveNavPill('hqpSettings');
  }

  switchSettingsSubview(currentSubview, targetSubview) {
    this.transition(() => {
      currentSubview.hide();
      this.subviewZ++;
      targetSubview.$el.css('z-index', this.subviewZ);
      targetSubview.show();
      this.updatePageHolderSubviewClass(targetSubview);
    });
  }

  doAppTitleClick() {
    const topSubview = this.getTopSubview();
    if (topSubview && topSubview !== this.libraryView) {
      this.hideSubview(topSubview);
    }
  }

  hidePlaylist() {
    this.hideSubview(this.playlistView);
  }

  hideAlbumView() {
    this.hideSubview(this.albumView);
    if (this.libraryView?.albumsList?.updateOverlayVisibility) {
      this.libraryView.albumsList.updateOverlayVisibility();
    }
  }

  hideSettingsView() {
    this.hideSubview(this.settingsView);
  }

  hideHqpSettingsView() {
    this.hideSubview(this.hqpSettingsView);
  }

  doEscape() {
    // first account for overlays, etc
    if (ViewUtil.isDisplayed(FullAlbumOverlay.$overlayScreen)) {
      FullAlbumOverlay.animateOut();
      return;
    }
    if (this.playbarView.volumePanel.isShowing) {
      this.playbarView.hideVolumePanel();
      return;
    }
    if ($(document.body).css('pointer-events') == 'none') {
      return;
    }

    const subview = this.getTopSubview();
    switch (subview) {
      case this.albumView:
        this.hideAlbumView();
        break;
      case this.playlistView:
        const result = this.playlistView.onEscape();
        if (!result) {
          this.hidePlaylist();
        }
        break;
      case this.settingsView:
        this.hideSettingsView();
        break;
      case this.hqpSettingsView:
        this.hideHqpSettingsView();
        break;
      case this.libraryView:
        this.libraryView.onEscape();
        break;
      default:
        if (subview) {
          console.log('not accounted for');
        }
        break;
    }
  }

  // ---
  // subview management

  showSubview(subview, ...extra) {
    if (this.getTopSubview() === subview) {
      $(document).trigger('enable-user-input');
      return;
    }

    this.transition(() => {
      // Hide ALL other subviews behind the overlay so no old content
      // can flash through during layout shifts (grid recalculation, etc.)
      for (let other of this.subviews) {
        if (other !== subview && ViewUtil.isVisible(other.$el)) {
          other.hide();
        }
      }

      TopBarUtil.returnSubviewHeader(true);
      this.subviewZ++;
      subview.$el.css('z-index', this.subviewZ);
      subview.show(...extra);
      this.updatePageHolderSubviewClass(subview);
    });
  }

  hideSubview(subview) {
    if (!ViewUtil.isVisible(subview.$el)) {
      $(document).trigger('enable-user-input');
      return;
    }

    this.transition(() => {
      subview.hide();

      // Make sure the view underneath is visible
      const exposed = this.getTopSubview();
      if (!exposed) {
        // Nothing visible — show library as fallback
        ViewUtil.setVisible(this.libraryView.$el, true);
        this.libraryView.$el.css('opacity', 1);
        this.updatePageHolderSubviewClass(this.libraryView);
      } else {
        this.updatePageHolderSubviewClass(exposed);
      }
      this.postHideHeaderAndFocus(subview.$el);
    });
  }

  /**
   * Updates page holder css classes related to play state.
   */
  updateMostStateClasses() {
    // playing, paused, stopped (mutually exclusive)
    if (Model.status.isPlaying) {
      this.$pageHolder.addClass('isPlaying').removeClass('isPaused isStopped');
    } else if (Model.status.isPaused) {
      this.$pageHolder.addClass('isPaused').removeClass('isPlaying isStopped');
    } else {
      this.$pageHolder.addClass('isStopped').removeClass('isPlaying isPaused');
    }

    // empty playlist
    if (Model.playlist.array.length > 0) {
      this.$pageHolder.removeClass('isPlaylistEmpty');
    } else {
      this.$pageHolder.addClass('isPlaylistEmpty');
    }

    // Album tab disabled state
    const hasCurrentAlbum = !!this.getCurrentAlbum();
    const isAlbumVisible = ViewUtil.isVisible(this.albumView.$el);

    if (hasCurrentAlbum || isAlbumVisible) {
      this.$navPills.filter('[data-view="album"]').removeClass('isDisabled');
    } else {
      this.$navPills.filter('[data-view="album"]').addClass('isDisabled');
    }

    this.updateBusyClass();
  }

  updateBusyClass() {
    if (Busyer.isBusy) {
      this.$pageHolder.addClass('isBusy');
    } else {
      this.$pageHolder.removeClass('isBusy');
    }
  }

  /**
   * Updates css classes on #page which describe which subview is currently showing.
   * todo: is this still being used for any thing?!
   */
  updatePageHolderSubviewClass(subview) {
    // note how class name is that of the subview's id!
    const cls = subview.$el.attr('id');
    // trying to prevent triggering unnecessary dom changes twice here, basically
    const all = ['libraryView', 'albumView', 'playlistView', 'settingsView', 'hqpSettingsView'];
    for (let item of all) {
      if (item !== cls) {
        this.$pageHolder.removeClass(item);
      }
    }
    this.$pageHolder.addClass(cls);
  }

  /** Should be called before hiding current subview. */
  updatePageHolderSubviewClassOnHide() {
    const subviews = this.getVisibleSubviews();
    if (subviews.length < 2) {
      this.updatePageHolderSubviewClass(this.libraryView);
      return;
    }
    // The subview which is about to get exposed by the current subview's hide()
    const subview = subviews[1];
    this.updatePageHolderSubviewClass(subview);
  }

  updateMetaEnabledClass() {
    const b = (MetaUtil.isReady === true && Model.library.albums.length > 0);
    if (b) {
      this.$pageHolder.addClass("isMetaEnabled");
    } else {
      this.$pageHolder.removeClass("isMetaEnabled");
    }
  }

  /**
   * Upon hiding a view, focus on the topmost view that just got exposed.
   * (Cursor-scrolling convenience)
   */
  postHideHeaderAndFocus($elementWhichIsHiding) {
    const $els = [this.albumView.$el, this.playlistView.$el, this.settingsView.$el];
    let $target;
    for (let $element of $els) {
      if ($element == $elementWhichIsHiding) {
        continue;
      }
      if (ViewUtil.isVisible($element)) {
        $target = $element;
      }
    }
    if (!$target) {
      $target = this.libraryView.$el;
    }

    TopBarUtil.returnSubviewHeader(true);
    TopBarUtil.updateFor($target, true);
    ViewUtil.setFocus($target);
  }

  /** Returns the top-most visible subview, or null. */
  getTopSubview() {
    let maxZ = 0;
    let topSubview;
    for (let subview of this.subviews) {
      if (ViewUtil.isVisible(subview.$el)) {
        const z = parseInt(subview.$el.css('z-index'), 10) || 0;
        if (z > maxZ) {
          maxZ = z;
          topSubview = subview;
        }
      }
    }
    return topSubview;
  }

  /** Returns list of visible subviews in z-index order, desc. */
  getVisibleSubviews() {
    const array = [];
    for (let subview of this.subviews) {
      if (ViewUtil.isVisible(subview.$el)) {
        const z = parseInt(subview.$el.css('z-index'), 10) || 0;
        array.push({ subview: subview, z: z });
      }
    }
    array.sort((a, b) => {
      if (a.z > b.z) {
        return -1;
      } else if (a.z < b.z) {
        return 1;
      } else {
        return 0; // shdnthpn
      }
    });
    return array.map(item => item.subview);
  }

  // ---
  // handlers, various

  /**
   * When a keypress executes an action, we set a `minKeyDuration`
   * which must elapse before a new keypress will be accepted.
   * 
   */
  onKeydown = (e) => {
    const isFocusInput = $(document.activeElement).is('input');
    if (isFocusInput) {
      return;
    }

    // Ignore keypresses if a modal popup is up (eg context menu, etc)
    // except for the following cases:
    if ($(document.body).css('pointer-events') == 'none') {
      let isWhitelisted = false;
      switch (e.key) {
        case 'Escape':
        case '+':
        case '=':
        case '-':
          isWhitelisted = true;
          break;
      }
      if (!isWhitelisted) {
        return;
      }
    }

    const elapsed = new Date().getTime() - this.lastKeyTime;
    if (elapsed < this.minKeyDuration) {
      return;
    }

    this.lastKeyTime = new Date().getTime();

    const short = 100;
    // should match or exceed $app-standard-duration
    const long = 450;

    switch (e.key) {
      case 'Escape':
        this.doEscape();
        this.minKeyDuration = long;
        break;
      case 'q':
        this.playbarView.$showPlaylistButton.click();
        this.minKeyDuration = long;
        break;
      case 'u':
        // Toggle hqp settings view
        if (ViewUtil.isVisible(this.hqpSettingsView.$el)) {
          this.hideHqpSettingsView();
        } else {
          this.showHqpSettingsView();
        }
        this.minKeyDuration = long;
        break;
      case 'f':
        if (this.getTopSubview() == this.libraryView
          && ViewUtil.isDisplayed(this.libraryView.albumsList.$el) && Model.hasLibrary) {
          e.preventDefault();
          this.libraryView.$searchButton.click();
        }
        break;
      case 's':
        this.playbarView.$stopButton.click();
        this.minKeyDuration = long;
        break;
      case 'p':
        this.playbarView.$playButton.click();
        this.minKeyDuration = long;
        break;
      case 'j':
        this.playbarView.$previousButton.click();
        this.minKeyDuration = long;
        break;
      case 'k':
        this.playbarView.$nextButton.click();
        this.minKeyDuration = long;
        break;
      case ',':
        this.playbarView.$seekBackwardButton.click();
        this.minKeyDuration = short;
        break;
      case '.':
        this.playbarView.$seekForwardButton.click();
        this.minKeyDuration = short;
        break;
      case '+':
      case '=':
        if (!ViewUtil.isVisible(this.playbarView.volumePanel.$el)) {
          this.playbarView.$volumeToggle.click()
        }
        this.playbarView.volumePanel.$plus1.click();
        this.minKeyDuration = short;
        break;
      case '-':
        if (!ViewUtil.isVisible(this.playbarView.volumePanel.$el)) {
          this.playbarView.$volumeToggle.click();
        }
        this.playbarView.volumePanel.$minus1.click();
        this.minKeyDuration = short;
        break;
    }
  };

  applyLibrarySearchFromAlbum(value) {
    const searchValue = (value || '').trim();

    SidebarView.resetFilters();
    this.goToLibraryView();

    if (this.libraryView.$globalSearchInput && this.libraryView.$globalSearchInput.length > 0) {
      this.libraryView.$globalSearchInput.val(searchValue);
    }
    if (this.libraryView.$globalSearchClear && this.libraryView.$globalSearchClear.length > 0) {
      this.libraryView.$globalSearchClear.css('display', searchValue ? 'flex' : 'none');
    }

    if (searchValue.length === 0) {
      this.libraryView.clearHeaderSearchFilter();
      return;
    }
    this.libraryView.applyHeaderSearchFilter(searchValue);
  }

  onAlbumGenreButton(genre) {
    this.applyLibrarySearchFromAlbum(genre);
  }

  onGlobalSearchEnter = (value = '') => {
    if (this.getTopSubview() !== this.libraryView) {
      this.goToLibraryView();
    }

    const searchValue = (value || '').trim();
    if (searchValue.length === 0) {
      this.libraryView.clearHeaderSearchFilter();
    } else {
      this.libraryView.applyHeaderSearchFilter(searchValue);
    }
  };

  onAlbumArtistButton(artist) {
    this.applyLibrarySearchFromAlbum(artist);
  }

  onMetaLoadResult(isSuccess) {
    this.updateMetaEnabledClass();

    if (isSuccess === true) {
      this.metaRetryCount = 0;
      if (this.metaRetryTimeoutId) {
        clearTimeout(this.metaRetryTimeoutId);
        this.metaRetryTimeoutId = 0;
      }
      return;
    }

    if (MetaUtil.isLoading) {
      return;
    }
    if (this.metaRetryCount >= this.metaRetryMax) {
      return;
    }

    this.metaRetryCount += 1;
    if (this.metaRetryTimeoutId) {
      clearTimeout(this.metaRetryTimeoutId);
    }
    this.metaRetryTimeoutId = setTimeout(() => {
      this.metaRetryTimeoutId = 0;
      if (MetaUtil.isLoading || MetaUtil.isReady) {
        return;
      }
      MetaUtil.init();
    }, 2500);
  }

  /** Triggers custom resize event 100ms after last window resize event. */
  onWindowResize = (e) => {
    clearTimeout(this.resizeTimeoutId);
    this.resizeTimeoutId = setTimeout(() => {
      this.doWindowResize();
    }, 100);
  };

  onServiceResponseHandled(type, data) {
    // Hide snackbar if issue resolved
    if (!SnackView.id) {
      return;
    }
    if (SnackView.id == 'server-error') {
      // A response by definition means that the server is back
      SnackView.hide();
    } else if (SnackView.id == 'hqp-disconnected') {
      if (!data['error']) {
        SnackView.hide();
      }
    }
  }

  onDisableUserInput() {
    $(document.body).css('pointer-events', 'none');
  }
  onUndisableUserInput() {
    $(document.body).css('pointer-events', '');
  }

  doWindowResize() {
    // Must set <body> height programmatically because
    // 100vh + `webkit-fill-available` fails on Mobile Firefox
    $('body').height(window.innerHeight);

    // Views should listen for this if they need to know about window-resize
    $(document).trigger('debounced-window-resize');
  }

  // ---
  // modal-related

  showFatalError(errorCode) {
    Statuser.stop();
    this.libraryView.setSpinnerState(false);

    let msg = `HQPWV Server can't connect to HQPlayer`;
    msg += `<br>Please make sure HQPlayer is running.`;
    msg += `<br><br><a href="${Values.TROUBLESHOOTING_HREF}" class="colorTextLess">Troubleshooting tips<a>`;
    DialogView.show('Problem', msg, 'Reload', true, e => window.location.reload());
  }

  showHqpDisconnectedSnack(errorCode) {
    const title = `HQPWV Server has lost connection to HQPlayer`;
    // let msg = `Make sure HQPlayer is running. <span class="colorTextLess"><a href="${Values.TROUBLESHOOTING_HREF}">Troubleshooting tips<a>.</span>`;
    let msg = `Make sure HQPlayer is running.`;
    SnackView.show('hqp-disconnected', title, msg);
  }

  showServerErrorsSnack(statusCode) {
    const title = `HQPWV Server is not responding`;
    // let msg = `Restart server if necessary. <span class="colorTextLess"><a href="${Values.TROUBLESHOOTING_HREF}">Troubleshooting tips<a>.</span>`;
    let msg = `Restart server if necessary.`;
    SnackView.show('server-error', title, msg);
  }
}