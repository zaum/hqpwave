import TopBarUtil from './top-bar-util.js';
import ViewUtil from './view-util.js';

/**
 * Base class for the primary views, which are children of #mainView and occupy its full area.
 * Subclasses use the term 'View', fyi.
 * Not much at the moment.
 */
export default class Subview {

  $el;
  $list;

  constructor($el, $list = null) {
    this.$el = $el;
    this.$list = $list;
    this.$el.on("scroll", e => this.onScroll(e));
  }

  /**
   * Subclass should super.show()
   */
  show(...extra) {
    ViewUtil.setVisible(this.$el, true);

    let done = false;
    const complete = () => {
      if (done) {
        return;
      }
      done = true;
      this.$el.css('opacity', 1);
      this.$el.css('filter', 'brightness(1)');
      ViewUtil.setFocus(this.$el);
    };

    const fallbackTimeoutId = setTimeout(complete, 420);

    ViewUtil.setCssSync(this.$el, () => {
      this.$el.css('opacity', 0);
      this.$el.css('filter', 'brightness(1.08)');
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.$el.one('transitionend', () => {
          clearTimeout(fallbackTimeoutId);
          complete();
        });
        this.$el.css('opacity', 1);
        this.$el.css('filter', 'brightness(1)');
      });
    });
  }

  // Override as needed
  hide(callback = null) {
    if (!ViewUtil.isVisible(this.$el)) {
      if (callback) {
        callback();
      }
      return;
    }

    let done = false;
    const complete = () => {
      if (done) {
        return;
      }
      done = true;
      ViewUtil.setVisible(this.$el, false);
      this.$el.css('filter', 'brightness(1)');
      if (callback) {
        callback();
      }
    };

    const opacity = this.$el.css('opacity');
    if (opacity == '0') {
      complete();
      return;
    }

    const fallbackMs = 420;
    const fallbackTimeoutId = setTimeout(complete, fallbackMs);

    ViewUtil.animateCss(this.$el,
      null,
      () => {
        this.$el.css('opacity', 0);
        this.$el.css('filter', 'brightness(1.08)');
      },
      () => {
        clearTimeout(fallbackTimeoutId);
        complete();
      });
  }

  onScroll(e) {
    // Delegate to TopBarUtil - animation lock in top-bar-util.js prevents double animations
    TopBarUtil.onSubviewScroll(this.$el);
  }
}
