/* Timeline minimap is implemented in timeline-minimap.js module. */
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
    Util.addAppListener(this, 'playbar-cover-updated', this.updateMostStateClasses);
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

    // Make the correct things visible.
    // Important: don't call subview.hide() here because subclasses may have
    // side effects (event unbinding, enabling input, etc.).
    for (let subview of this.subviews) {
      ViewUtil.setVisible(subview.$el, false);
      subview.$el.css('display', 'none');
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

    // Acute 
    if (view === 'settings') {
      this.$settingsButton.addClass('active');
    } else if (view === 'hqpSettings') {
      this.$hqpSettingsButton.addClass('active');
    } else {
      this.$navPills.filter(`[data-view="${view}"]`).addClass('active');
    }

    // Show/hide back-to-library button: hide when library view is active
    try {
      const $backBtn = $('#backToLibraryButton');
      if ($backBtn && $backBtn.length) {
        if (view === 'library') {
          $backBtn.hide();
        } else {
          $backBtn.show();
        }
      }
    } catch (e) {
      // ignore DOM issues
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

      this.libraryView.show();
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
    this.showPlaylistCompoundView("history");
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

    // If we couldn't resolve an album via metadata/playlist, try matching
    // the playbar cover URL to a library album hash (coversEndpoint + hash).
    const coverUrl = (this.playbarView && this.playbarView._coverUrl) ? this.playbarView._coverUrl : null;
    if (coverUrl && Model.hasLibrary) {
      try {
        const base = Values.imagesEndpoint;
        if (coverUrl.startsWith(base)) {
          const rest = coverUrl.substring(base.length);
          const hash = rest.split('?')[0];
          if (hash) {
            const found = Model.library.getAlbumByAlbumHash(hash);
            if (found) {
              this.showAlbumView(found);
              return;
            }
          }
        }
      } catch (e) {
        // ignore and fall through to default behavior
      }
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

  /**
   * Show playlist compound view and choose which internal subview is active.
   * @param {"playlist"|"history"|"load"} type
   */
  showPlaylistCompoundView(type = "playlist") {
    if (ViewUtil.isVisible(this.playlistView.$el) && !this.isPlaylistViewUsable()) {
      this.resetStalePlaylistViewState();
    }

    // If already on top, just switch the internal subview (no overlay needed).
    if (this.getTopSubview() === this.playlistView) {
      this.playlistView.showSubview(type);
      this.updatePageHolderSubviewClass(this.playlistView);
      return;
    }

    this.transition(() => {
      // Hide ALL other subviews behind the overlay.
      for (let other of this.subviews) {
        if (other !== this.playlistView && ViewUtil.isVisible(other.$el)) {
          other.hide();
        }
      }

      TopBarUtil.returnSubviewHeader(true);
      this.subviewZ++;
      this.playlistView.$el.css('z-index', this.subviewZ);
      this.playlistView.showSubview(type);
      this.updatePageHolderSubviewClass(this.playlistView);
      TopBarUtil.updateFor(this.playlistView.$el, true);
      ViewUtil.setFocus(this.playlistView.$el);

      // Only fetch playlist data when showing the main playlist view.
      if (type === "playlist") {
        Service.queueCommandFront(Commands.playlistGet());
      }
    });
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
    this.playlistView.hide();
  }

  trackListItemToAlbum(album) {
    this.albumView.hide();
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
      // Ensure the correct topbar icon is highlighted when swapping
      if (targetSubview === this.settingsView) {
        this.setActiveNavPill('settings');
      } else if (targetSubview === this.hqpSettingsView) {
        this.setActiveNavPill('hqpSettings');
      }
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
        this.libraryView.show();
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
    // Consider an album 'loaded' not only when we can resolve a library album,
    // but also when status metadata or the playbar cover URL is present.
    const statusMeta = Model.status?.metadata || {};
    const hasCurrentAlbum = !!this.getCurrentAlbum()
      || Boolean(statusMeta['@_album'] || statusMeta['@_uri'])
      || (!!this.playbarView && !!this.playbarView._coverUrl);
    const isAlbumVisible = ViewUtil.isVisible(this.albumView.$el);

    if (hasCurrentAlbum || isAlbumVisible) {
      this.$navPills.filter('[data-view="album"]').removeClass('isDisabled');
    } else {
      this.$navPills.filter('[data-view="album"]').addClass('isDisabled');
    }

    // No extra visual marker; nav-pill enabled/disabled is handled by `isDisabled` only.

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
        e.preventDefault();
        // If we're already on the library and the albums list is visible,
        // trigger the existing search button behavior.
        if (this.getTopSubview() == this.libraryView
          && ViewUtil.isDisplayed(this.libraryView.albumsList.$el) && Model.hasLibrary) {
          this.libraryView.$searchButton.click();
        } else {
          // Otherwise, navigate to the library view and focus the global search input
          // after the transition completes so the input receives the caret.
          this.goToLibraryView();
          setTimeout(() => {
            try {
              if (this.libraryView.$globalSearchInput && this.libraryView.$globalSearchInput.length > 0) {
                ViewUtil.setFocus(this.libraryView.$globalSearchInput);
              }
            } catch (err) {
              // ignore focus errors
            }
          }, this.transitionDurationMs + 40);
        }
        this.minKeyDuration = long;
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
    const h = window.innerHeight;
    $('body').height(h);
    // Keep the app's root grid from overflowing the visible viewport height.
    // This prevents bottom clipping of the playbar when the topbar grows taller
    // (e.g. 768-1024px two-row topbar in some emulated/mobile viewports).
    $('#page').height(h);

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
