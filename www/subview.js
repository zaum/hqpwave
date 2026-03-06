import TopBarUtil from './top-bar-util.js';
import ViewUtil from './view-util.js';

/**
 * Base class for the primary views, which are children of #mainView and occupy its full area.
 * Subclasses use the term 'View', fyi.
 *
 * Show/hide are instant (no opacity animation) since all view transitions
 * are handled by the ViewTransition overlay.
 */
export default class Subview {

  $el;
  $list;
  _throttledScrollHandler;

  constructor($el, $list = null) {
    this.$el = $el;
    this.$list = $list;
    // Throttled scroll handler for better performance on mobile
    this._throttledScrollHandler = this._throttle((e) => this.onScroll(e), 16); // ~60fps
    this.$el.on("scroll", this._throttledScrollHandler);
  }

  /**
   * Subclass should super.show()
   * Instantly makes the view visible (no fade animation).
   */
  show(...extra) {
    this.$el.css('opacity', 1);
    this.$el.css('filter', 'brightness(1)');
    ViewUtil.setVisible(this.$el, true);
    ViewUtil.setFocus(this.$el);
  }

  /**
   * Override as needed.
   * Instantly hides the view (no fade animation).
   */
  hide(callback = null) {
    ViewUtil.setVisible(this.$el, false);
    this.$el.css('opacity', 1);
    this.$el.css('filter', 'brightness(1)');
    if (callback) {
      callback();
    }
  }

  onScroll(e) {
    // Delegate to TopBarUtil - animation lock in top-bar-util.js prevents double animations
    TopBarUtil.onSubviewScroll(this.$el);
  }

  /**
   * Simple throttle function for performance optimization
   */
  _throttle(func, limit) {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    }
  }
}
