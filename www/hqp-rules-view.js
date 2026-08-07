import Settings from './settings.js';
import Model from './model.js';
import PresetUtil from './preset-util.js';
import HqpConfigModel from './hqp-config-model.js';
import Util from './util.js';

export default class HqpRulesView {

  constructor($el) {
    this.$el = $el;
    this.$toggle = this.$el.find('#rulesEnableToggle');
    this.$list = this.$el.find('#genreRulesList');
    this.$addBtn = this.$el.find('#genreRuleAddBtn');
    this.$defaultsBtn = this.$el.find('#genreRuleDefaultsBtn');

    this.onToggleChange = () => {
      Settings.enableRules = this.$toggle.prop('checked');
      this.$list.toggleClass('isDisabled', !Settings.enableRules);
      this.$addBtn.closest('.presetAddRow').toggleClass('isDisabled', !Settings.enableRules);
    };
    this.render = () => {
      this.$toggle.prop('checked', Settings.enableRules);

      const mode = HqpConfigModel.normalizeMode(Model.status.data['@_active_mode']) || 'PCM';
      const genres = this.getGenreNames();
      const presets = this.getPresetNames(mode);

      // Auto-populate defaults if rules are empty and genres are available
      if (Settings.genreRules.length === 0 && genres.length > 0) {
        this.autoPopulateDefaults(genres, Settings.getPresetsArray(mode));
      }

      const rules = Settings.genreRules;
      const usedGenres = this.getUsedGenres(-1);

      let html = '';
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        html += this.buildRuleRow(i, rule, genres, presets, usedGenres);
      }
      this.$list.html(html);

      this.$list.toggleClass('isDisabled', !Settings.enableRules);

      const $remove = this.$list.find('.genreRuleRemove');
      $remove.on('click tap', (e) => this.onRemoveRule(e));
    };

    this.onAddRule = () => {
      const genres = this.getGenreNames();
      const usedGenres = this.getUsedGenres(-1);
      const available = genres.filter(g => !usedGenres.has(g));
      if (available.length === 0) return;

      Settings.genreRules.push({ genre: available[0], presetIndex: '0' });
      Settings.commitGenreRules();
      this.render();
    };
    this.onAddDefaults = () => {
      const genres = this.getGenreNames();
      const usedGenres = new Set(Settings.genreRules.map(r => r.genre).filter(Boolean));
      const mode = HqpConfigModel.normalizeMode(Model.status.data['@_active_mode']) || 'PCM';
      const presets = Settings.getPresetsArray(mode);

      let added = 0;
      for (const genre of genres) {
        if (!usedGenres.has(genre)) {
          const presetIndex = this.findMatchingPresetIndex(genre, presets);
          Settings.genreRules.push({ genre: genre, presetIndex: presetIndex });
          added++;
        }
      }
      if (added > 0) {
        Settings.commitGenreRules();
        this.render();
      }
    };

    this.$toggle.on('change', this.onToggleChange);
    this.$addBtn.on('click tap', this.onAddRule);
    this.$defaultsBtn.on('click tap', this.onAddDefaults);

    $(document).on('model-library-updated', this.render);
    $(document).on('model-status-updated', this.render);
    $(document).on('upscaling-data-updated', this.render);

    this.render();
  }

  onShow() { }

  onHide() { }



  getGenreNames() {
    return Model.library.genreNames || [];
  }

  getPresetNames(mode) {
    const arr = Settings.getPresetsArray(mode);
    return arr.map((p, i) => ({ name: p.name || 'Preset ' + (i + 1), index: i }));
  }

  getUsedGenres(excludeIndex) {
    const rules = Settings.genreRules;
    const used = new Set();
    for (let i = 0; i < rules.length; i++) {
      if (i !== excludeIndex && rules[i].genre) {
        used.add(rules[i].genre);
      }
    }
    return used;
  }

  findMatchingPresetIndex(genre, presets) {
    const g = genre.toLowerCase();
    for (let i = 0; i < presets.length; i++) {
      const pName = presets[i].name;
      if (pName && g.includes(pName.toLowerCase())) {
        return String(i);
      }
    }
    return '0';
  }

  autoPopulateDefaults(genres, presetArray) {
    const usedGenres = new Set();
    for (const genre of genres) {
      if (!usedGenres.has(genre)) {
        const presetIndex = this.findMatchingPresetIndex(genre, presetArray);
        Settings.genreRules.push({ genre: genre, presetIndex: presetIndex });
        usedGenres.add(genre);
      }
    }
    Settings.commitGenreRules();
  }

  buildRuleRow(index, rule, genres, presets, usedGenres) {
    const genreOptions = genres.map(g => {
      const disabled = usedGenres.has(g) && rule.genre !== g;
      const selected = rule.genre === g ? 'selected' : '';
      return `<option value="${Util.escapeHtml(g)}" ${selected} ${disabled ? 'disabled' : ''}>${Util.escapeHtml(g)}</option>`;
    }).join('');

    const presetOptions = presets.map(p => {
      const selected = String(p.index) === String(rule.presetIndex) ? 'selected' : '';
      return `<option value="${p.index}" ${selected}>${Util.escapeHtml(p.name)}</option>`;
    }).join('');

    return `
      <div class="genreRuleItem" data-index="${index}">
        <span class="genreRuleText">If playing genre is</span>
        <select class="genreRuleGenreSelect">${genreOptions}</select>
        <span class="genreRuleText">apply preset</span>
        <select class="genreRulePresetSelect">${presetOptions}</select>
        <button class="genreRuleDeleteBtn" title="Delete rule"></button>
      </div>`;
  }

}
