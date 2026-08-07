import Subview from'./subview.js';
import Values from './values.js';
import ViewUtil from './view-util.js';
import Util from './util.js';
import Commands from './commands.js';
import Model from './model.js';
import Service from './service.js';
import Settings from './settings.js';
import SettingsInfoView from './settings-info-view.js';
import HqpFiltersView from './hqp-filters-view.js';
import HqpConfigModel from './hqp-config-model.js';
import PresetUtil from './preset-util.js';

/**
 *
 */
export default class ThresholdRuleView {

  constructor($el) {
    this.$el = $el;
    this.$leastMostSelect = this.$el.find('#ruleThresholdLeastMostSelect');
    this.$fsSelect = this.$el.find('#ruleThresholdFs');
    this.$presetASelect = this.$el.find('#ruleThresholdPresetA');
    this.$presetBSelect = this.$el.find('#ruleThresholdPresetB');

    this.onLeastMostChange = (e) => {
      this.commitValues();
    };

    this.onFsChange = (e) => {
      this.commitValues();
    };

    this.onPresetAChange = (e) => {
      this.commitValues();
    };

    this.onPresetBChange = (e) => {
      this.commitValues();
    };

    this.$leastMostSelect.on('change', this.onLeastMostChange);
    this.$fsSelect.on('change', this.onFsChange);
    this.$presetASelect.on('change', this.onPresetAChange);
    this.$presetBSelect.on('change', this.onPresetBChange);

    this.$el.addClass('isDisabled');
    Util.addAppListener(this, 'upscaling-data-updated', this.onUpscalingDataUpdated);
  }

  onUpscalingDataUpdated(mode) {
    if (mode == HqpConfigModel.MODE_PCM) {
      this.init();
    }
  }

  init() {
    const mode = HqpConfigModel.MODE_PCM;
    this.populateFsSelect();
    PresetUtil.populateSelect(this.$presetASelect, mode);
    PresetUtil.populateSelect(this.$presetBSelect, mode);
    this.applySettingsValues();
    this.$el.removeClass('isDisabled');
  }

  populateFsSelect() {
    this.$fsSelect.empty();
    for (let multiple of HqpConfigModel.pcmFsMultiples) {
      const rateA = Math.floor(multiple * HqpConfigModel.PCM_MULTIPLE_A / 1000);
      const rateB = Math.floor(multiple * HqpConfigModel.PCM_MULTIPLE_B / 1000);
      const text = `${multiple}fs (${rateA}/${rateB}k)`;
      const s = `<option value="${multiple}">${text}</option>`;
      this.$fsSelect.append(s);
    }
  }

  applySettingsValues() {
    this.$leastMostSelect[0].value = Settings.thresholdRule.leastMost;
    this.$fsSelect[0].value = Settings.thresholdRule.fs;
    this.$presetASelect[0].value = Settings.thresholdRule.presetA;
    this.$presetBSelect[0].value = Settings.thresholdRule.presetB;
  }

  commitValues() {
    Settings.thresholdRule.leastMost = this.$leastMostSelect[0].value;
    Settings.thresholdRule.fs = this.$fsSelect[0].value;
    Settings.thresholdRule.presetA = this.$presetASelect[0].value;
    Settings.thresholdRule.presetB = this.$presetBSelect[0].value;
    Settings.commitThresholdRule();
  }

  /** Returns default settings object. */
  static getDefaultValues() {
    return {
      leastMost: 'most',
      fs: '1',
      presetA: '0',
      presetB: '1'
    };
  }
}
