import TopBar from './top-bar.js';
import ViewUtil from './view-util.js';

/**
 *
 */
class TopBarUtil {

  VIEW_HEADER_HEIGHT = 52; // must match scss $view-header-height
  THRESHOLD;

  $libraryView = $('#libraryView');
  $libraryHeader;

  $subview;
  $header;

  // Track state to prevent unnecessary operations
  isHeaderTaken = false;
  // Animation lock to prevent double animations
  isAnimating = false;

  constructor() {
    this.VIEW_HEADER_HEIGHT = window.innerWidth <= 480 ? 120 : 52;
    this.THRESHOLD = this.VIEW_HEADER_HEIGHT * 0.5;
    this.$libraryView = $('#libraryView');
    this.$libraryHeader = this.$libraryView.find('.viewHeader');
    // Set initial padding to accommodate the visible header
    this.$libraryView.css('padding-top', '');
  }

  /**
   *
   */
  takeSubviewHeader($subview, now) {
    // Don't do anything if already taken or animation in progress
    if (this.isHeaderTaken || this.isAnimating) {
      return;
    }

    const $h = $subview.find('.viewHeader');
    if ($h.length == 0) {
      return;
    }
    this.$subview = $subview;
    this.$header = $h;

    this.isHeaderTaken = true;
    this.isAnimating = true;

    // TopBar.hideButtons(); // Disabled - keep top bar visible

    TopBar.$el.append(this.$header);
    $subview.css('padding-top', '8px');

    if (now) {
      ViewUtil.setCssPropertySync(this.$header, 'top', 0);
      this.isAnimating = false;
    } else {
      ViewUtil.animateCss(this.$header,
        () => { this.$header.css('top', (this.VIEW_HEADER_HEIGHT - 8)) },
        () => { this.$header.css('top', 0) },
        () => { this.isAnimating = false; });
    }
  }

  /**
   * Gives back header to its subview.
   */
  returnSubviewHeader(now) {
    // Don't do anything if already returned or animation in progress
    if (!this.isHeaderTaken || this.isAnimating) {
      return;
    }

    if (!this.$header) {
      return;
    }

    this.isHeaderTaken = false;
    this.isAnimating = true;

    TopBar.showButtons();

    this.$subview.append(this.$header);
    this.$subview.css('padding-top', this.VIEW_HEADER_HEIGHT + 'px');

    if (now) {
      ViewUtil.setCssPropertySync(this.$header, 'top', 0);
      this.isAnimating = false;
    } else {
      ViewUtil.animateCss(this.$header,
        () => { this.$header.css('top', -(this.VIEW_HEADER_HEIGHT - 16)) },
        () => { this.$header.css('top', 0) },
        () => { this.isAnimating = false; });
    }

    this.$subview = null;
    this.$header = null;
  }

  /**
   * Should be called when transitioning forward or backward between subviews.
   *
   * @param $subview is the subview which is or is-about-to-be exposed via either an anim-in or out.
   */
  updateFor($subview, now) {
    const y = $subview[0].scrollTop;

    if (!this.$subview) {
      if (y > this.THRESHOLD) {
        this.takeSubviewHeader($subview, now);
      }
    } else { // has subview
      if (y == 0) {
        this.returnSubviewHeader(now);
      }
    }
  }

  /**
   * Should be called by subviews on-scroll.
   */
  onSubviewScroll($subview) {
    this.updateFor($subview);
  }
}

export default new TopBarUtil();
