import ViewUtil from './view-util.js';

/**
 * 
 */
export default class ModealPointerUtil {

  whitelist$;
  callback;
  disableUserInput;

  /**
   * @param whitelist$ jquery object or array of jquery objects that should remain clickable
   * @param callback is called when click is not on a whitelisted element 
   */
  constructor(whitelist$, callback, disableUserInput = true) {
    this.whitelist$ = Array.isArray(whitelist$) ? whitelist$ : [whitelist$];
    this.callback = callback;
    this.disableUserInput = disableUserInput;
  }

  start() {
    setTimeout(() => $(document).on('click tap', this.onDocumentClick), 1);
    if (this.disableUserInput) {
      $(document).trigger('disable-user-input');
    }
    const addPointerEvents = ($item) => {
      $item.css('pointer-events', 'auto');
      $item.find('*').css('pointer-events', 'auto');
    };
    for (const $item of this.whitelist$) {
      addPointerEvents($item);
    }
  }

  clear() {
    $(document).off('click tap', this.onDocumentClick);
    if (this.disableUserInput) {
      $(document).trigger('enable-user-input');
    }
    const removePointerEvents = ($item) => {
      $item.css('pointer-events', '');
      $item.find('*').css('pointer-events', '');
    };
    for (const $item of this.whitelist$) {
      removePointerEvents($item);
    }
  }

  onDocumentClick = (e) => {
    let b = false;
    for (const $item of this.whitelist$) {
      if ($item.has($(e.target)).length > 0) {
        b = true;
        break;
      }
    }
    if (!b) {
      this.clear();
      this.callback();
    }
  };
}
