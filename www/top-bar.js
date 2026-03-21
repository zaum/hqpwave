import Util from './util.js';
import ViewUtil from './view-util.js';

/**
 *
 */
class TopBar {

  $el = $("#topBar");
  $appTitle = this.$el.find('#appTitle');
  $topBarButtons = $('#topBarButtons');

  constructor() {
    // appTitle visible from start
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
