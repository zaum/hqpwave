import Values from './values.js';
import Util from './util.js';
import ViewUtil from './view-util.js';
import Model from './model.js';
import Service from './service.js';
import Settings from './settings.js';
import Dropdown from './dropdown.js';
import ModalPointerUtil from './modal-pointer-util.js';

/**
 * Row of controls along the top of the lib view.
 * Manages dropdown toggle buttons and their dropdowns.
 */
export default class LibraryAlbumOptionsView {

  $el;
  $buttonsHolder;
  $expandCollapseButton;
  $sortButton;
  $groupButton;
  $filterButton;

  sortDropdown;
  groupDropdown;
  filterDropdown;
  dropdowns;
  pointerUtil;

  constructor($el) {
    this.$el = $el;

    this.$buttonsHolder = this.$el.find('#libraryOptionsButtons');
    this.$expandCollapseButton = this.$el.find('#libraryExpandCollapseButton');
    this.$sortButton = this.$el.find('#librarySortButton');
    this.$groupButton = this.$el.find('#libraryGroupButton');
    this.$filterButton = this.$el.find('#libraryFilterButton');

    this.sortDropdown = new Dropdown($('#librarySortDropdown'));
    this.groupDropdown = new Dropdown($('#libraryGroupDropdown'));
    this.filterDropdown = new Dropdown($('#libraryFilterDropdown'));
    this.dropdowns = [this.sortDropdown, this.groupDropdown, this.filterDropdown];

    // Include dropdown elements in pointer util whitelist so they remain clickable
    this.pointerUtil = new ModalPointerUtil(
      [this.$el, this.sortDropdown.$el, this.groupDropdown.$el, this.filterDropdown.$el],
      () => this.hideDropdowns()
    );

    this.$expandCollapseButton.on('click tap', () => this.onExpandCollapseClick());
    this.$sortButton.on('click tap', e => this.toggleDropdown(this.sortDropdown));
    this.$groupButton.on('click tap', e => this.toggleDropdown(this.groupDropdown));
    this.$filterButton.on('click tap', e => this.toggleDropdown(this.filterDropdown));
    $(document).on('dropdown-item-select', this.onDropdownItemSelect);

    // Conditionally hide the expand/collapse button based on 'group by none' selection
    const updateExpandCollapseVisibility = () => {
      if (Settings.libraryGroupType === 'none') {
        this.$expandCollapseButton.hide();
      } else {
        this.$expandCollapseButton.show();
      }
    };

    // Initial visibility update
    updateExpandCollapseVisibility();

    // Trigger visibility update when the group type changes
    $(document).on('library-albums-group-changed', updateExpandCollapseVisibility);
  }

  onExpandCollapseClick() {
    if (this.$expandCollapseButton.hasClass('isSelected')) {
      // Currently in "collapse" state, so collapse all and switch to expand
      this.$expandCollapseButton.removeClass('isSelected');
      this.$expandCollapseButton.attr('title', 'Expand all');
      $(document).trigger('library-collapse-all-groups');
    } else {
      // Currently in "expand" state, so expand all and switch to collapse
      this.$expandCollapseButton.addClass('isSelected');
      this.$expandCollapseButton.attr('title', 'Collapse all');
      $(document).trigger('library-expand-all-groups');
    }
  }

  toggleDropdown(dropdown) {
    ViewUtil.isDisplayed(dropdown.$el)
        ? this.hideDropdowns()
        : this.selectDropdown(dropdown);
  }

  selectDropdown(dropdown) {
    // Select corresponding button
    this.$sortButton.removeClass('isSelected');
    this.$groupButton.removeClass('isSelected');
    this.$filterButton.removeClass('isSelected');
    let $button;
    switch (dropdown) {
      case this.sortDropdown:
        $button = this.$sortButton;
        break;
      case this.groupDropdown:
        $button = this.$groupButton;
        break;
      case this.filterDropdown:
        $button = this.$filterButton;
        break;
    }
    if ($button) {
      $button.addClass('isSelected');
    }

    // Show given dropdown only
    for (const item of this.dropdowns) {
      if (item != dropdown) {
        item.hide();
      }
    }
    
    // Move dropdown to body to escape any overflow/transform containers
    // Store original parent for moving back later
    if (!dropdown.$el.data('originalParent')) {
      dropdown.$el.data('originalParent', dropdown.$el.parent());
    }
    
    // Move to body if not already there
    if (dropdown.$el.parent()[0] !== document.body) {
      dropdown.$el.appendTo('body');
    }
    
    // Position the fixed dropdown at the button location
    if ($button) {
      const buttonRect = $button[0].getBoundingClientRect();
      dropdown.$el.css({
        'top': buttonRect.bottom + 'px',
        'left': (buttonRect.left - 175 + 36) + 'px' // Align right edge of dropdown with button
      });
    }
    
    dropdown.show();

    // Update dropdown item selection/s
    let items = [];
    switch (dropdown) {
      case this.sortDropdown:
        items = [Settings.librarySortType];
        break;
      case this.groupDropdown:
        items = [Settings.libraryGroupType];
        break;
      case this.filterDropdown:
        items = [Settings.libraryFilterType];
        break;
    }
    dropdown.selectItems(items);

    this.$buttonsHolder.addClass('isSelected');

    this.pointerUtil.start();
  }

  hideDropdowns() {
    this.$buttonsHolder.removeClass('isSelected');
    this.$sortButton.removeClass('isSelected');
    this.$groupButton.removeClass('isSelected');
    this.$filterButton.removeClass('isSelected');

    for (const dropdown of this.dropdowns) {
      dropdown.hide();
    }
    this.pointerUtil.clear();
  }

  onDropdownItemSelect = (e, dropdownId, value) => {
    this.hideDropdowns();
    switch (dropdownId) {
      case 'librarySortDropdown':
        Settings.librarySortType = value;
        setTimeout(() => $(document).trigger('library-albums-sort-changed'), 16);
        break;
      case 'libraryGroupDropdown':
        Settings.libraryGroupType = value;
        setTimeout(() => $(document).trigger('library-albums-group-changed'), 16);
        break;
      case 'libraryFilterDropdown':
        Settings.libraryFilterType = value;
        setTimeout(() => $(document).trigger('library-albums-filter-changed'), 16);
        break;
    }
  };
}
