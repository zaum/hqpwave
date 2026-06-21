import Subview from'./subview.js';
import Values from './values.js';
import ViewUtil from './view-util.js';
import Util from './util.js';
import Commands from './commands.js';
import Model from './model.js';
import Service from './service.js';
import Settings from './settings.js';
import PresetUtil from './preset-util.js';
import SettingsInfoView from './settings-info-view.js';
import HqpFiltersView from './hqp-filters-view.js';
import HqpConfigModel from './hqp-config-model.js';

/**
 * Manages the dynamic preset list UI.
 * 'Child' of HqpFiltersView.
 */
export default class HqpPresetsView {

  $el;
  $list;
  $addBtn;
  $defaultsBtn;
  currentMode = '';
  dragStartIndex = -1;
  dragCurrentIndex = -1;
  $dragGhost = null;
  dragItemHeight = 0;

  constructor($el) {
    this.$el = $el;
    this.$list = this.$el.find('#hqpPresetsList');
    this.$addBtn = this.$el.find('#presetAddBtn');
    this.$defaultsBtn = this.$el.find('#presetDefaultsBtn');
    this.$addBtn.on('click tap', this.onAddPreset);
    this.$defaultsBtn.on('click tap', this.onLoadDefaults);
    $(document).on('model-status-updated', this.onModelStatusUpdated);
    this.currentMode = HqpConfigModel.normalizeMode(Model.status.data['@_active_mode']) || 'PCM';
    this.render();
  }

  onModelStatusUpdated = () => {
    const mode = HqpConfigModel.normalizeMode(Model.status.data['@_active_mode']);
    if (mode && mode !== this.currentMode) {
      this.currentMode = mode;
      this.render();
    }
  };

  render() {
    const arr = Settings.getPresetsArray(this.currentMode);
    let html = '';
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const name = p.name || 'Preset ' + (i + 1);
      const desc = PresetUtil.toString(p);
      html += `
        <div class="presetItem" data-index="${i}">
          <div class="presetDragHandle" title="Drag to reorder"></div>
          <div class="presetMain">
            <div class="presetName" title="Click to apply">${Util.escapeHtml(name)}</div>
            <div class="presetDesc">${Util.escapeHtml(desc)}</div>
          </div>
          <div class="presetRenameBtn" title="Rename preset"></div>
          <div class="presetDeleteBtn" title="Delete preset"></div>
        </div>`;
    }
    this.$list.html(html);

    // Bind drag handle
    this.$list.find('.presetDragHandle').each((i, el) => {
      const $handle = $(el);
      $handle.on('mousedown touchstart', (e) => {
        e.stopPropagation();
        this.onDragHandleDown(e);
      });
    });

    // Bind item clicks
    this.$list.find('.presetItem').each((i, el) => {
      const $item = $(el);
      const index = parseInt($item.attr('data-index'));

      $item.on('click tap', (e) => {
        if ($(e.target).closest('.presetDragHandle, .presetRenameBtn, .presetDeleteBtn').length) return;
        this.onLoadPreset(index);
      });

      const $renameBtn = $item.find('.presetRenameBtn');
      $renameBtn.on('click tap', (e) => {
        e.stopPropagation();
        this.onRenamePreset(index);
      });

      const $deleteBtn = $item.find('.presetDeleteBtn');
      $deleteBtn.on('click tap', (e) => {
        e.stopPropagation();
        this.onDeletePreset(index);
      });
    });
  }

  onDragHandleDown(event) {
    const $handle = $(event.currentTarget);
    const $item = $handle.closest('.presetItem');
    const index = parseInt($item.attr('data-index'));
    if (isNaN(index) || index < 0) return;

    event.preventDefault();
    this.dragStartIndex = index;
    this.dragCurrentIndex = index;
    this.dragItemHeight = $item.outerHeight();

    // Create ghost
    this.$dragGhost = $item.clone();
    this.$dragGhost.addClass('presetDragGhost');
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;
    this.$dragGhost.css({
      position: 'fixed',
      left: clientX - 20,
      top: clientY - 20,
      zIndex: 10002,
      pointerEvents: 'none',
      width: $item.outerWidth()
    });
    $('body').append(this.$dragGhost);

    // Hide original
    $item.addClass('isDragging');
    $item.css('opacity', '0');

    // Store original positions
    this.originalPositions = [];
    this.$list.find('.presetItem:not(.isDragging)').each((i, el) => {
      const rect = ViewUtil.getRect(el);
      this.originalPositions.push({ element: el, rect: rect });
    });

    $(document).on('mousemove.presetDrag', this.onDragMove);
    $(document).on('mouseup.presetDrag', this.onDragEnd);
    $(document).on('touchmove.presetDrag', this.onDragMove);
    $(document).on('touchend.presetDrag touchcancel.presetDrag', this.onDragEnd);
  }

  onDragMove = (event) => {
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;

    // Update ghost position
    if (this.$dragGhost) {
      this.$dragGhost.css({
        left: clientX - 20,
        top: clientY - 20
      });
    }

    // Find target index based on cursor Y position vs item midpoints
    const $items = this.$list.find('.presetItem:not(.isDragging)');
    let targetIndex = -1;
    $items.each((i, el) => {
      const rect = ViewUtil.getRect(el);
      const midY = rect.top + rect.height / 2;
      if (clientY < midY && targetIndex === -1) {
        targetIndex = i;
      }
    });
    if (targetIndex === -1) {
      targetIndex = $items.length;
    }

    // Only update if target changed significantly
    if (Math.abs(targetIndex - this.dragCurrentIndex) >= 1) {
      this.dragCurrentIndex = targetIndex;
      this.updatePositionsForDrag();
    }
  };

  updatePositionsForDrag() {
    if (this.dragStartIndex === -1 || this.dragCurrentIndex === -1) return;

    const $items = this.$list.find('.presetItem:not(.isDragging)');
    const gapPos = this.dragCurrentIndex;

    $items.each((i, el) => {
      const $item = $(el);
      if (i >= gapPos) {
        $item.css({
          transform: `translateY(${this.dragItemHeight}px)`,
          transition: 'transform 150ms ease-out'
        });
      } else {
        $item.css({
          transform: 'translateY(0)',
          transition: 'transform 150ms ease-out'
        });
      }
    });
  }

  onDragEnd = () => {
    $(document).off('.presetDrag');

    // Remove ghost
    if (this.$dragGhost) {
      this.$dragGhost.remove();
      this.$dragGhost = null;
    }

    // Restore original item
    const from = this.dragStartIndex;
    const $orig = this.$list.find(`.presetItem[data-index="${from}"]`);
    $orig.removeClass('isDragging');
    $orig.css('opacity', '');

    // Reset all positions smoothly
    this.$list.find('.presetItem').css({
      transform: 'translateY(0)',
      transition: 'transform 200ms ease-out'
    });

    const to = this.dragCurrentIndex;
    this.dragStartIndex = -1;
    this.dragCurrentIndex = -1;
    this.originalPositions = null;

    if (from >= 0 && to >= 0 && from !== to) {
      const arr = Settings.getPresetsArray(this.currentMode);
      const item = arr.splice(from, 1)[0];
      arr.splice(to, 0, item);
      this.commit();
      this.render();
    }
  };

  onLoadPreset(index) {
    $(document).trigger('load-hqp-preset-button', index);
  }

  onLoadDefaults = () => {
    const defaults = HqpConfigModel.isDsmMode(this.currentMode)
      ? JSON.parse(JSON.stringify([
          { name: 'Jazz', mode: 'DSD', filter: 'poly-sinc-lp', shaper: 'ASDM7' },
          { name: 'Classical', mode: 'DSD', filter: 'poly-sinc-ext2', shaper: 'ASDM7' },
          { name: 'Rock', mode: 'DSD', filter: 'poly-sinc-short-mp', shaper: 'DSD5' },
          { name: 'Blues', mode: 'DSD', filter: 'poly-sinc-lp', shaper: 'ASDM7' },
          { name: 'Electronic', mode: 'DSD', filter: 'poly-sinc-hb-lp', shaper: 'DSD7' },
          { name: 'Pop', mode: 'DSD', filter: 'sinc-M', shaper: 'ASDM7' }
        ]))
      : JSON.parse(JSON.stringify([
          { name: 'Jazz', mode: 'PCM', filter: 'sinc-M', shaper: 'NS5' },
          { name: 'Classical', mode: 'PCM', filter: 'sinc-L', shaper: 'NS9' },
          { name: 'Rock', mode: 'PCM', filter: 'poly-sinc-short-mp', shaper: 'LNS15' },
          { name: 'Blues', mode: 'PCM', filter: 'poly-sinc-lp', shaper: 'NS5' },
          { name: 'Electronic', mode: 'PCM', filter: 'poly-sinc-short-mp', shaper: 'NS9' },
          { name: 'Pop', mode: 'PCM', filter: 'sinc-M', shaper: 'LNS15' }
        ]));
    const arr = Settings.getPresetsArray(this.currentMode);
    const existingNames = new Set(arr.map(p => p.name));
    let added = 0;
    for (const d of defaults) {
      if (!existingNames.has(d.name)) {
        arr.push(d);
        added++;
      }
    }
    if (added > 0) {
      this.commit();
      this.render();
    }
  };

  onAddPreset = () => {
    const mode = this.currentMode;
    const filter = Model.status.data['@_active_filter'];
    const shaper = Model.status.data['@_active_shaper'];
    if (!mode || !filter || !shaper) {
      return;
    }
    const arr = Settings.getPresetsArray(mode);
    const count = arr.length;
    const o = {
      name: 'Preset ' + (count + 1),
      mode: mode,
      filter: filter,
      shaper: shaper
    };
    arr.push(o);
    this.commit();
    this.render();
    const $items = this.$list.find('.presetItem');
    if ($items.length) {
      $items.last()[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  onRenamePreset(index) {
    const $item = this.$list.find(`.presetItem[data-index="${index}"]`);
    const $nameEl = $item.find('.presetName');
    const currentName = $nameEl.text();
    const $input = $('<input class="presetNameInput" type="text" value="">');
    $input.val(currentName);
    $nameEl.replaceWith($input);
    $input.focus();
    $input.select();

    const finishRename = () => {
      const newName = $input.val().trim() || currentName;
      Settings.getPresetsArray(this.currentMode)[index].name = newName;
      this.commit();
      this.render();
    };

    $input.on('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishRename();
      } else if (e.key === 'Escape') {
        this.render();
      }
    });

    $input.on('blur', finishRename);
  }

  onDeletePreset(index) {
    const arr = Settings.getPresetsArray(this.currentMode);
    const p = arr[index];
    const name = (p && p.name) ? p.name : 'Preset ' + (index + 1);
    if (!confirm(`Are you sure you want to delete "${name}"?`)) {
      return;
    }
    arr.splice(index, 1);
    this.commit();
    this.render();
  }

  movePreset(fromIndex, toIndex) {
    const arr = Settings.getPresetsArray(this.currentMode);
    const item = arr.splice(fromIndex, 1)[0];
    arr.splice(toIndex, 0, item);
    this.commit();
    this.render();
  }

  commit() {
    if (HqpConfigModel.isDsmMode(this.currentMode)) {
      Settings.commitPresetsArrayDSD();
    } else {
      Settings.commitPresetsArrayPCM();
    }
  }

  updateLoadPresetsText() {
    this.render();
  }
}
