import ViewUtil from './view-util.js';
import ModalPointerUtil from './modal-pointer-util.js';

/**
 * A "context menu" that pops up upon clicking a "more" button.
 */
export default class ContextMenu {

  $el;
  $items;
  ModalPointerUtil;

  /**
   * Element is expected to have this structure:
   *   <div class="contextMenu">
   *     <div class="contextItem>Item 1</div>
   *     <div class="contextItem>Imte 2</div> ...
   *
   * And should be sibling of view triggering it
   */
  constructor($el) {
    this.$el = $el;
    this.$items = this.$el.find('.contextItem');
    this.$items.on('click tap', e => this.onItemClick(e));
    this.ModalPointerUtil = new ModalPointerUtil(this.$el, () => this.hide(), false);
    if (!this.$el.length || !this.$items.length) {
      cl('warning bad dom structure or properties, will fail.');
    }
  }

  /**
   * Subclass should override and super.
   *
   * @param $holder is the holder which contains the button which triggers the context menu
   * @param $button
   * @param rest are any other params the subclass may need (eg, some data)
   */
  show($holder, $button, ...rest) {
    // Context menu uses `position: fixed`, so coordinates must be viewport-based.
    const rect = ViewUtil.getRect($button[0], (newRect) => {
      // Reposition if measurements change after load
      const menuWidth = this.$el.outerWidth();
      const menuHeight = this.$el.outerHeight();
      let nx = newRect.left - menuWidth - 10;
      let ny = newRect.top;
      if (ny + menuHeight > window.innerHeight - 8) {
        ny = newRect.bottom - menuHeight;
      }
      nx = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, nx));
      ny = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, ny));
      this.$el.css('left', nx);
      this.$el.css('top', ny);
    });
    const menuWidth = this.$el.outerWidth();
    const menuHeight = this.$el.outerHeight();

    let x = rect.left - menuWidth - 10;
    let y = rect.top;

    if (y + menuHeight > window.innerHeight - 8) {
      y = rect.bottom - menuHeight;
    }
    x = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, y));

    this.$el.css("left", x);
    this.$el.css("top", y);
    this.$el.addClass('isVisible');
    ViewUtil.setVisible(this.$el, true);

    this.ModalPointerUtil.whitelist$ = [this.$el, $button];
    this.ModalPointerUtil.start();
  }

  hide() {
    this.$el.removeClass('isVisible');
    ViewUtil.setVisible(this.$el, false);
    this.ModalPointerUtil.clear();
  }

  /**
   * Subclass should override and super, and add business logic.
   * (Note how method must not be a closure to be override-able)
   */
  onItemClick(event) {
    this.hide();
  }
}
