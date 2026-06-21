import Settings from './settings.js';
import PresetUtil from './preset-util.js';
import Model from './model.js';
import HqpConfigModel from './hqp-config-model.js';

/**
 *
 */
export default class AbRuleView {

  $el;
  $aSelect;
  $bSelect;
  _lastMode = '';

  constructor($el) {
    this.$el = $el;
    this.$aSelect = $el.find('#ruleAbPresetA');
    this.$bSelect = $el.find('#ruleAbPresetB');
    $(document).on('model-status-updated', this.onModelStatusUpdated);
    this.$aSelect.on('change', this.onSelectChange);
    this.$bSelect.on('change', this.onSelectChange);
    this.repopulate();
    this.applySettingsValues();
  }

  repopulate() {
    const mode = HqpConfigModel.normalizeMode(Model.status.data['@_active_mode']) || 'PCM';
    PresetUtil.populateSelect(this.$aSelect, mode);
    PresetUtil.populateSelect(this.$bSelect, mode);
  }

  onModelStatusUpdated = () => {
    const mode = HqpConfigModel.normalizeMode(Model.status.data['@_active_mode']);
    if (mode && mode !== this._lastMode) {
      this._lastMode = mode;
      this.repopulate();
      this.applySettingsValues();
    }
  }

  applySettingsValues() {
    this.$aSelect[0].value = Settings.abRule['a'];
    this.$bSelect[0].value = Settings.abRule['b'];
  }

  onSelectChange = () => {
    Settings.abRule['a'] = this.$aSelect[0].value;
    Settings.abRule['b'] = this.$bSelect[0].value;
    Settings.commitAbRule();
  }

  /** Returns default settings object. */
  static getDefaultValues() {
    return {
      a: '0',
      b: '1'
    };
  }

}
