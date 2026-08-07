import Util from './util.js';
import ViewUtil from './view-util.js';
import Model from './model.js';
import Service from './service.js';

/**
 *
 */
export default class Dropdown {

  /**
   * $el is expected to have the following structure:
   *
   * <div class='dropdown'>
   *   <div class='dropdownTitle'>
   *     <div class='dropdownItems'>
   *       <div class='dropdownItem' data-value='something'>
   *       <div class='dropdownItem' data-value='something'>...
   */
  constructor($el, isMulti) {
    this.$el = $el;
    this.isMulti = isMulti;
    this.selectedIndex = -1;

    this.$items = $el.find('.dropdownItem');
    this.$items.on('click tap', this.onItemClick);
    this.onItemClick = (e) => {
      if (!this.isMulti && $(e.currentTarget).hasClass('isSelected')) {
        return;
      }
      const value = $(e.currentTarget).attr('data-value');
      if (!value) {
        cl('warning dropdown item missing data-value');
        return;
      }
      $(document).trigger('dropdown-item-select', [this.$el.attr('id'), value]);
    };
  }

  selectItems(arrayOfValues) {
    for (let i = 0; i < this.$items.length; i++) {
      const $item = $(this.$items[i]);
      let hit = false;
      for (const value of arrayOfValues) {
        if ($item.attr('data-value') === value) {
          hit = true;
          break;
        }
      }
      if (hit) {
        $item.addClass('isSelected');
      } else {
        $item.removeClass('isSelected');
      }
    }
  }

  show() {
    ViewUtil.setDisplayed(this.$el, true);
    ViewUtil.forceReflow(this.$el);
    ViewUtil.setVisible(this.$el, true);
    this.$el.addClass('animIn');
  }
  
  hide() {
    this.$el.removeClass('animIn');
    ViewUtil.setVisible(this.$el, false);
    ViewUtil.setDisplayed(this.$el, false);
  }

}
