import Util from './util.js';
import ViewUtil from './view-util.js';
import Model from './model.js';
import DataUtil from './data-util.js';
import Commands from './commands.js';
import Service from './service.js';
import Settings from './settings.js';
import HqpConfigModel from './hqp-config-model.js';
import PresetUtil from './preset-util.js';
import HqpPresetsView from './hqp-presets-view.js';
import SnackView from './snack-view.js';

/**
 * Has upscaler settings controls.
 * Also 'owns' presets view.
 */
export default class HqpFiltersView {

  constructor($el) {
    this.$el = $el;
    this.outputBitrateString = null;

    this.$modeSwitcher = this.$el.find('#modeSwitcher');
    this.$filterSelect = this.$el.find('#filterSelect');
    this.$shaperSelect = this.$el.find('#shaperSelect');

    this.$info = this.$el.find('#hqpFiltersInfo');
    this.$outputBitrate = this.$el.find('#outputBitrate');
    this.$outputBitrateValue = this.$el.find('#outputBitrateValue');

    this.populateSelects = () => {
      const mode = HqpConfigModel.normalizeMode(Model.status.data['@_active_mode']);
      this.highlightActiveMode(mode);

      const filterName = Model.status.data['@_active_filter'];
      const filtersArray = HqpConfigModel.filtersData[mode];
      this.populateSelect(this.$filterSelect, filtersArray, '@_name', '@_index', filterName);

      const shaperName = Model.status.data['@_active_shaper'];
      const shapersArray = HqpConfigModel.shapersData[mode];
      this.populateSelect(this.$shaperSelect, shapersArray, '@_name', '@_index', shaperName);
    };
    this.populateSelectsRedundant = () => {
      setTimeout(() => Service.queueCommand(Commands.status(), this.populateSelects), 250);
      setTimeout(() => Service.queueCommand(Commands.status(), this.populateSelects), 1000);
      this.$el.css('pointer-events', 'none');
      setTimeout(() => this.$el.css('pointer-events', ''), 1100);
    };
    this.onSelectChange = (e) => {
      const select = e.currentTarget;
      const value = select.value;
      if (value == undefined) {
        cl('warning no value on select', select);
        return;
      }

      let command;
      let label;
      if (select === this.$filterSelect[0]) {
        command = Commands.setFilter(value);
        label = 'filter';
      } else if (select === this.$shaperSelect[0]) {
        command = Commands.setShaping(value);
        label = 'shaper';
      }

      if (command == undefined) {
        cl('warning no command');
        return;
      }

      Service.queueCommandsFront([{ xml: command, callback: (data) => {
        const b = DataUtil.isResultOk(data);
        if (!b) {
          SnackView.show('set-error', 'HQPlayer response', `Couldn't set ${label}`, '');
        }
        HqpConfigModel.updateData(() => Service.queueCommandFront(Commands.status()) );
      }, suppressHqpErrorToast: true }]);
    };
    this.onModelStatusUpdated = () => {
      if (Model.status.isStopped) {
        ViewUtil.setDisplayed(this.$info, false);
      }

      this.updateOutputBitrate();

      const mode = HqpConfigModel.normalizeMode(Model.status.data['@_active_mode']);
      this.highlightActiveMode(mode);
      if (Model.status.data['@_active_filter'] != Model.lastStatus.data['@_active_filter']) {
        const filterName = Model.status.data['@_active_filter'];
        const filtersArray = HqpConfigModel.filtersData[mode];
        this.populateSelect(this.$filterSelect, filtersArray, '@_name', '@_index', filterName);
      }
      if (Model.status.data['@_active_shaper'] != Model.lastStatus.data['@_active_shaper']) {
        const shaperName = Model.status.data['@_active_shaper'];
        const shapersArray = HqpConfigModel.shapersData[mode];
        this.populateSelect(this.$shaperSelect, shapersArray, '@_name', '@_index', shaperName);
      }
    };
    this.onModeBtnClick = (e) => {
      const $btn = $(e.currentTarget);
      const mode = $btn.attr('data-mode');
      if ($btn.hasClass('isActive')) return;
      const modeIndex = HqpConfigModel.getModeIndex(mode);
      if (modeIndex == null) return;
      this.$modeSwitcher.css('pointer-events', 'none');
      Service.queueCommandsFront([{ xml: Commands.setMode(modeIndex), callback: (data) => {
        this.$modeSwitcher.css('pointer-events', '');
        const b = DataUtil.isResultOk(data);
        if (!b) {
          SnackView.show('set-error', 'HQPlayer response', `Couldn't set mode to ${mode}`, '');
          const actualMode = HqpConfigModel.normalizeMode(Model.status.data['@_active_mode']);
          this.highlightActiveMode(actualMode);
        }
        HqpConfigModel.updateData(() => Service.queueCommandFront(Commands.status()));
      }, suppressHqpErrorToast: true }]);
    };

    this.$modeSwitcher.on('click', '.mode-btn', this.onModeBtnClick);
    this.$filterSelect.on('change', this.onSelectChange);
    this.$shaperSelect.on('change', this.onSelectChange);

    this.presetsView = new HqpPresetsView($('#hqpPresetsView'));

    Util.addAppListener(this, 'upscaling-data-updated', this.onUpscalingDataUpdated);
    Util.addAppListener(this, 'load-hqp-preset-button', this.onLoadPresetButton);
  }

  onUpscalingDataUpdated(mode) {
    this.populateSelects();
  }

  onShow() {
    this.populateSelects();
    $(document).on('model-status-updated', this.onModelStatusUpdated);

    this.updateOutputBitrate();

    ViewUtil.setDisplayed(this.$info, !Model.status.isStopped);
  }

  onHide() {
    $(document).off('model-status-updated', this.onModelStatusUpdated);
  }
  
  /**
   * @param $select the <select> to be be populated
   * @param array the data array from which the <options> will be populated
   * @param labelKey the key from the array's object items used for the <option> text
   * @param indexKey the key from the array's object items used for the <option value>
   * @param selectedLabelText dictates which <option> should be selected (bc this is how the data comes in from <Status>)
   */
  populateSelect($select, array, labelKey, indexKey, selectedLabelText) {
    // Filter item properties: name, index, value
    // Shaper items properties: name, index, value
    $select.empty();
    let optionsHtml = '';
    if (array) {
      for (let item of array) {
        const optionText = item[labelKey];
        const value = item[indexKey];
        const selectedness = (optionText == selectedLabelText) ? 'selected' : '';
        optionsHtml += `<option value="${value}" ${selectedness}>${optionText}</option>`;
      }
    }
    $select.html(optionsHtml);
  }

  updateOutputBitrate() {
    const lastOutputBitrateString = this.outputBitrateString;
    const rate = Model.status.data['@_active_rate'] || '';
    const bits = Model.status.data['@_active_bits'] || '';
    const mode = HqpConfigModel.normalizeMode(Model.status.data['@_active_mode']) || '';
    this.outputBitrateString = '';
    let sampleRateUnit = '';
    let bitDepthText = '';
    let formatLabel = '';
    
    if (rate) {
      const rateInt = parseInt(rate);
      if (mode === 'PCM') {
        sampleRateUnit = 'kHz';
        this.outputBitrateString = (rateInt / 1000).toString();
      } else if (HqpConfigModel.isDsmMode(mode)) {
        sampleRateUnit = 'MHz';
        this.outputBitrateString = (rateInt / 1000000).toString();
        if (bits) {
          formatLabel = bits;
        }
      } else {
        // source or unknown mode — could be either, show raw rate
        this.outputBitrateString = rate;
      }
      
      if (bits && !HqpConfigModel.isDsmMode(mode) && mode !== HqpConfigModel.MODE_SOURCE) {
        bitDepthText = bits + ' bit';
      }
    }
    
    // Format the display string with units and format label
    let displayString = this.outputBitrateString;
    if (sampleRateUnit) {
      displayString += ' ' + sampleRateUnit;
    }
    if (bitDepthText) {
      displayString += ' ' + bitDepthText;
    }
    if (formatLabel) {
      displayString = displayString ? displayString + ' • ' + formatLabel : formatLabel;
    }
    
    if (displayString != lastOutputBitrateString) {
      this.outputBitrateString = displayString;
      this.$outputBitrateValue.text(displayString);
    }
  }

  onLoadPresetButton(index) {
    const mode = HqpConfigModel.normalizeMode(Model.status.data['@_active_mode']);
    const arr = Settings.getPresetsArray(mode);
    const preset = arr[index];
    PresetUtil.applyPreset(preset, () => {
      this.populateSelectsRedundant();
    });
  }

  highlightActiveMode(mode) {
    this.$modeSwitcher.find('.mode-btn').each((i, el) => {
      const btn = $(el);
      const btnMode = btn.attr('data-mode');
      if (btnMode === mode) {
        btn.addClass('isActive');
      } else {
        btn.removeClass('isActive');
      }
    });
  }

}
