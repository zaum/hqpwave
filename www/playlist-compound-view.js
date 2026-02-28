import Util from './util.js';
import ViewUtil from './view-util.js';
import Subview from './subview.js';
import Commands from './commands.js';
import Service from './service.js';
import PlaylistMainView from './playlist-view.js';
import HistoryView from './history-view.js';
import LoadPlaylistView from './load-playlist-view.js';

/**
 * 'Compound view' consisting of playlist-view-proper, history-view, and load-playlist view.
 */
export default class PlaylistCompoundView extends Subview {

  mainView;
  historyView;
  loadView;

  constructor() {
    super($("#playlistView"));
    this.mainView = new PlaylistMainView(this.$el.find('#playlistMainView'));
    this.historyView = new HistoryView(this.$el.find('#historyView'));
    this.loadView = new LoadPlaylistView(this.$el.find('#loadPlaylistView'));

    Util.addAppListener(this, 'playlist-history-button', this.mainToHistoryView);
    Util.addAppListener(this, 'playlist-load-button', this.mainToLoadView);

    Util.addAppListener(this, 'history-close-button', this.historyToMainView);
    Util.addAppListener(this, 'load-playlist-close', this.loadToMainView);
  }

  /**
   * Clears stale transitionend handlers that accumulate on sub-view elements.
   * (.subview has no CSS transition on 'left', so animateCss callbacks never fire
   * and .one('transitionend') handlers pile up.)
   */
  _clearStaleHandlers() {
    this.mainView.$el.off('transitionend');
    this.historyView.$el.off('transitionend');
    this.loadView.$el.off('transitionend');
  }

  show() {
    this._clearStaleHandlers();
    super.show();
    this.$el.css('transform', '');

    ViewUtil.setVisible(this.historyView.$el, false);
    ViewUtil.setVisible(this.loadView.$el, false);
    ViewUtil.setVisible(this.mainView.$el, true);
    this.mainView.$el.css('left', '0%');
    this.mainView.onShow();

    // Enable user input immediately, not just after animation
    $(document).trigger('enable-user-input');
  }

  hide() {
    if (!ViewUtil.isVisible(this.$el)) {
      $(document).trigger('enable-user-input');
      return;
    }

    this._clearStaleHandlers();
    this.mainView.onHide();
    this.historyView.onHide();
    this.loadView.onHide();

    super.hide(() => {
      ViewUtil.setVisible(this.historyView.$el, false);
      ViewUtil.setVisible(this.loadView.$el, false);
      ViewUtil.setVisible(this.mainView.$el, false);
      $(document).trigger('enable-user-input');
    });
  }

  /** Like Android Activity.onBack() */
  onEscape() {
    if (ViewUtil.isVisible(this.historyView.$el)) {
      this.historyToMainView();
      return true;
    }
    if (ViewUtil.isVisible(this.loadView.$el)) {
      this.loadToMainView();
      return true;
    }
    // Must be main view
    if (ViewUtil.isDisplayed(this.mainView.savePanel.$el)) {
      this.mainView.savePanel.hide();
      return true;
    }
    return false;
  }

  /**
   * Sub-view transitions: direct CSS changes (no animateCss).
   * .subview has no CSS transition on 'left', so animateCss transitionend
   * callbacks would never fire, causing stale handler accumulation.
   */

  mainToHistoryView() {
    this.mainView.onHide();
    this.historyView.onShow();

    this.mainView.$el.css('left', '-100%');
    ViewUtil.setVisible(this.mainView.$el, false);

    this.historyView.$el.css('left', '0%');
    ViewUtil.setVisible(this.historyView.$el, true);
  }

  historyToMainView() {
    this.historyView.onHide();
    this.mainView.onShow();

    this.historyView.$el.css('left', '100%');
    ViewUtil.setVisible(this.historyView.$el, false);
    this.historyView.clear();

    this.mainView.$el.css('left', '0%');
    ViewUtil.setVisible(this.mainView.$el, true);
  }

  mainToLoadView() {
    this.mainView.onHide();
    this.loadView.onShow();

    this.mainView.$el.css('left', '-100%');
    ViewUtil.setVisible(this.mainView.$el, false);

    this.loadView.$el.css('left', '0%');
    ViewUtil.setVisible(this.loadView.$el, true);
  }

  loadToMainView() {
    this.loadView.onHide();
    this.mainView.onShow();

    // Safety-net retry: in case the PlaylistGet done before closing
    // returned stale data, fetch again after HQPlayer has had more time.
    setTimeout(() => Service.queueCommandFront(Commands.playlistGet()), 1200);

    this.loadView.$el.css('left', '100%');
    ViewUtil.setVisible(this.loadView.$el, false);

    this.mainView.$el.css('left', '0%');
    ViewUtil.setVisible(this.mainView.$el, true);
  }
}
