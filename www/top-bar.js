import Util from './util.js';
import ViewUtil from './view-util.js';

/**
 *
 */
class TopBar {

  constructor() {
    this.$el = $("#topBar");
    this.$appTitle = this.$el.find('#appTitle');
    this.$topBarButtons = $('#topBarButtons');
  }

  showButtons() {
    ViewUtil.setVisible(this.$appTitle, true);
    ViewUtil.setVisible(this.$topBarButtons, true);
  }

  hideButtons() {
    ViewUtil.setVisible(this.$appTitle, false);
    ViewUtil.setVisible(this.$topBarButtons, false);
  }
}

export default new TopBar();
