import Commands from './commands.js';
import MetaUtil from './meta-util.js'
import ModalPointerUtil from './modal-pointer-util.js';
import Model from './model.js';
import PlaylistVo from './playlist-vo.js'
import Service from './service.js';
import Subview from './subview.js';
import ToastView from './toast-view.js';
import TrackListItemContextMenu from './track-list-item-context-menu.js';
import TrackListItemUtil from './track-list-item-util.js';
import Util from './util.js';
import Values from './values.js';
import ViewUtil from './view-util.js';

/**
 * Shows history of played tracks.
 */
export default class HistoryView  extends Subview {

  $count;
  trackMetaChangeHandler;
  tracks;
  _historyRefreshTimerId = 0;

  constructor($el) {
  	super($el);
    this.$list = this.$el.find('#historyList');
    this.$count = this.$el.find('#historyCount');
    this.$clearButton = this.$el.find('#historyClearButton');
    this.$el.find('#historyCloseButton').on("click tap", () => $(document).trigger('history-close-button'));
    this.$clearButton.on("click tap", this.onClearButton);
    this.trackMetaChangeHandler = TrackListItemUtil.makeTrackMetaChangeHandler(this.$list);
	}

  onShow() {
    this.populate();
    $(document).on('model-library-updated', this.onModelLibraryUpdated);
    $(document).on('meta-track-favorite-changed meta-track-incremented', this.trackMetaChangeHandler);
    // When history changes (MetaUtil.addToHistory happens on meta-track-incremented),
    // re-render so new entries appear while the view is open.
    $(document).on('meta-track-incremented', this.onHistoryChanged);
    // If the meta layer initializes/retries while History is open, refresh once it's ready
    // so the view doesn't look stale/empty.
    $(document).on('meta-load-result', this.onMetaLoadResult);
  }

  onHide() {
    TrackListItemContextMenu.hide();
    $(document).off('model-library-updated', this.onModelLibraryUpdated);
    $(document).off('meta-track-favorite-changed meta-track-incremented', this.trackMetaChangeHandler);
    $(document).off('meta-track-incremented', this.onHistoryChanged);
    $(document).off('meta-load-result', this.onMetaLoadResult);
    if (this._historyRefreshTimerId) {
      clearTimeout(this._historyRefreshTimerId);
      this._historyRefreshTimerId = 0;
    }
  }

  clear() {
    this.$list.empty();
  }

  populate() {
    this.clear();

    // parallel arrays (not great)
    const tracks = [];
    const agoStrings = [];
    const dateKeys = [];

    let prevHash = null;
    for (let i = MetaUtil.history.length - 1; i >= 0; i--) { // revchron

      const item = MetaUtil.history[i];

      // Skip consecutive duplicate tracks
      if (item['hash'] === prevHash) {
        continue;
      }
      prevHash = item['hash'];
      const track = Model.library.getTrackByHash(item['hash']) || {};
      tracks.push(track);

      const time = item['time'];
      if (!time) {
        agoStrings.push(''); // shdnthpn
        dateKeys.push('');
      } else {
        const ms = new Date().getTime() - time;
        const ago = Util.makeHowLongAgoString(ms);
        agoStrings.push(ago);
        // group by the shown ago-string so identical timestamps are collapsed
        dateKeys.push(ago);
      }

      if (tracks.length >= 500) {
        break;
      }
    }

    this.tracks = tracks;

    this.$count.text(tracks.length > 0 ? `(${tracks.length} tracks)` : ``);
    this.updateClearButton();

    if (tracks.length == 0) {
      const $nonItem = $(`<div id="playHisNonItem">No history</span>`);
      this.$list.append($nonItem);
      return;
    }

    TrackListItemUtil.populateHistoryList(this.$list, tracks, agoStrings, dateKeys);
    const $contextButtons = this.$list.find(".contextButton");
    $contextButtons.on("click tap", this.onContextButton);
	}

	onContextButton = (event) => {
    event.stopPropagation();
    const $button = $(event.currentTarget);
    const $listItem = $button.parent().parent();
    const index = parseInt($listItem.attr('data-index'));
    if (!(index >= 0)) {
      cl('warning no index');
      return;
    }
    const data = this.tracks[index];
    TrackListItemContextMenu.show(this.$el, $button, data);
	}

  updateClearButton() {
    if (MetaUtil.history.length > 0) {
      this.$clearButton.removeClass('isDisabled');
    } else {
      this.$clearButton.addClass('isDisabled');
    }
  }

  onClearButton = () => {
    if (!confirm('Are you sure you want to clear all history?')) {
      return;
    }
    MetaUtil.clearHistory();
    $.ajax({
      url: `${Values.META_ENDPOINT}?clearHistory`,
      cache: false
    });
    ToastView.show('History cleared');
  };

  onModelLibraryUpdated = () => {
    this.populate();
  };

  onHistoryChanged = () => {
    // Debounce bursts (track changes can trigger multiple updates quickly).
    if (this._historyRefreshTimerId) {
      return;
    }
    this._historyRefreshTimerId = setTimeout(() => {
      this._historyRefreshTimerId = 0;
      this.populate();
    }, 50);
  };

  onMetaLoadResult = (e, isSuccess) => {
    if (isSuccess === true) {
      this.populate();
    }
  };
}
