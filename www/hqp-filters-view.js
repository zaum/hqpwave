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

  $el;
  $modeSelect;
  $filterSelect;
  $shaperSelect;
  $info;
  $outputBitrate;
  $outputBitrateValue;

  presetsView;
  outputBitrateString = null;

  // todo `<FiltersItem index= name= value= />` [?]

  constructor($el) {
    this.$el = $el;

    this.$modeToggle = this.$el.find('#modeToggle');
    this.$filterSelect = this.$el.find('#filterSelect');
    this.$shaperSelect = this.$el.find('#shaperSelect');

    this.$modeToggle.on('change', this.onModeToggleChange);
    this.$filterSelect.on('change', this.onSelectChange);
    this.$shaperSelect.on('change', this.onSelectChange);

    this.$info = this.$el.find('#hqpFiltersInfo');
    this.$outputBitrate = this.$el.find('#outputBitrate');
    this.$outputBitrateValue = this.$el.find('#outputBitrateValue');


    this.presetsView = new HqpPresetsView(this.$el.find('#hqpPresetsView'));
    this.presetsView.updateLoadPresetsText();

    Util.addAppListener(this, 'upscaling-data-updated', this.onUpscalingDataUpdated);
    Util.addAppListener(this, 'save-hqp-preset-button', this.onSavePresetButton);
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
  
  populateSelects = () => {
    const mode = Model.status.data['@_active_mode'];
    // Set toggle state based on current mode
    this.$modeToggle.prop('checked', mode === 'DSD');

    const filterName = Model.status.data['@_active_filter'];
    const filtersArray = HqpConfigModel.filtersData[mode];
    this.populateSelect(this.$filterSelect, filtersArray, '@_name', '@_index', filterName);

    const shaperName = Model.status.data['@_active_shaper'];
    const shapersArray = HqpConfigModel.shapersData[mode];
    this.populateSelect(this.$shaperSelect, shapersArray, '@_name', '@_index', shaperName);
  };

  /**
   * Use this to guarantee (more or less) that views will get updated reliably after a 'set' command
   * due to the fact that 'set' commands are observed to not always be 'synchronous'.
   */
  populateSelectsRedundant = () => {
    setTimeout(() => Service.queueCommand(Commands.status(), this.populateSelects), 250);
    setTimeout(() => Service.queueCommand(Commands.status(), this.populateSelects), 1000);
    // also, block silently
    this.$el.css('pointer-events', 'none');
    setTimeout(() => this.$el.css('pointer-events', ''), 1100);
  };

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
    const mode = Model.status.data['@_active_mode'] || '';
    this.outputBitrateString = '';
    let sampleRateUnit = '';
    let bitDepthText = '';
    let formatLabel = '';
    
    if (rate) {
      const rateInt = parseInt(rate);
      if (mode === 'PCM') {
        // PCM rates are in Hz, convert to kHz
        sampleRateUnit = 'kHz';
        this.outputBitrateString = (rateInt / 1000).toString();
      } else if (mode === 'DSD') {
        // DSD rates are multiples, show as DSD64, DSD128, etc.
        sampleRateUnit = 'MHz';
        this.outputBitrateString = (rateInt / 1000000).toString();
        // Add DSD format label (DSD64, DSD128, etc.)
        if (bits) {
          formatLabel = bits;
        }
      } else {
        this.outputBitrateString = rate;
      }
      
      if (bits && mode !== 'DSD') {
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

  onSelectChange = (e) => {
    const select = e.currentTarget;
    // Note: The option value attribute holds the data object's _index_ value,
    // which is what's used for the 'Set' XML's "value" attribute (!)
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
      const b = DataUtil.isResultOk(data); // todo unverified
      if (!b) {
        SnackView.show('set-error', 'HQPlayer response', `Couldn't set ${label}`, '');
      }
      HqpConfigModel.updateData(() => Service.queueCommandFront(Commands.status()) );
    }, suppressHqpErrorToast: true }]);
  };

  onSavePresetButton(index) {
    const mode = Model.status.data['@_active_mode'];
    const filter = Model.status.data['@_active_filter'];
    const shaper = Model.status.data['@_active_shaper'];
    const o = { mode: mode, filter: filter, shaper: shaper };
    Settings.presetsArray[index] = o;
    Settings.commitPresetsArray();
    this.presetsView.updateLoadPresetsText();
  }

  onLoadPresetButton(index) {
    const preset = Settings.presetsArray[index];
    PresetUtil.applyPreset(preset, () => {
      this.populateSelectsRedundant();
    });
  }

  onModelStatusUpdated = () => {
    if (Model.status.isStopped) {
      ViewUtil.setDisplayed(this.$info, false);
    }

    this.updateOutputBitrate();

    // Diff status vs lastStatus
    const mode = Model.status.data['@_active_mode'];
    if (Model.status.data['@_active_mode'] != Model.lastStatus.data['@_active_mode']) {
      // Update toggle state based on current mode
      this.$modeToggle.prop('checked', mode === 'DSD');
    }
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
  }

  onModeToggleChange = (e) => {
    const isChecked = e.currentTarget.checked;
    const mode = isChecked ? 'DSD' : 'PCM';
    
    // Get the mode index from the modes array
    const modeIndex = HqpConfigModel.getModeIndex(mode);
    if (modeIndex === null) {
      cl('warning no mode index found for', mode);
      return;
    }

    Service.queueCommandsFront([{ xml: Commands.setMode(modeIndex), callback: (data) => {
      const b = DataUtil.isResultOk(data);
      if (!b) {
        SnackView.show('set-error', 'HQPlayer response', `Couldn't set mode to ${mode}`, '');
      }
      HqpConfigModel.updateData(() => Service.queueCommandFront(Commands.status()));
    }, suppressHqpErrorToast: true }]);
  }
}
