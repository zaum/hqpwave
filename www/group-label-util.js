import Settings from './settings.js';

/**
 * A group label is a collapsible header above a 'library group'.
 */
export default class GroupLabelUtil {

  /**
   * Returns a label DOM element or null
   */
  static makeLabel(label, labelClass, count=0) {

    const collapseKey = labelClass + ":" + encodeURIComponent(label.substr(0, 100));
    let s = '';
    s += `<div class="libraryGroupLabel ${labelClass}" data-collapsekey="${collapseKey}">`;
    s += `<span class="icon"></span>`;
    s += `<span class="inner">${label}</span>`;
    s += (count > 0) ? `<span class="count">${count}</span>` : '';
    s += `</div>`;

    const $label = $(s);
    $label.on('click tap', GroupLabelUtil.onClick);

    return $label;
  }

  static onClick = (event) => {
    // Get the label element
    const $label = $(event.currentTarget);
    
    // Toggle states of both the 'label' el and the 'group' el that follows it
    const $group = $label.next();
    const shouldCollapse = !$label.hasClass('isCollapsed');
    if (shouldCollapse) {
      $label.addClass('isCollapsed');
      $group.addClass('isCollapsed');
    } else {
      $label.removeClass('isCollapsed');
      $group.removeClass('isCollapsed');
    }

    // Update settings
    let key = $label.attr('data-collapsekey');
    if (key) {
      Settings.setLibraryGroupCollapsed(key, shouldCollapse);
    }
  };
}
