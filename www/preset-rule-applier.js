import Util from './util.js';
import Settings from './settings.js';
import HqpConfigModel from './hqp-config-model.js';
import PresetUtil from './preset-util.js';
import Model from './model.js';
import Commands from './commands.js';
import Service from './service.js';
import Statuser from './statuser.js';
import AppUtil from './app-util.js';

class PresetRuleApplier {

  constructor() {
    this.abCounter = 0;
    Util.addAppListener(this, 'new-track', this.onNewTrackDetected);
  }

  noop() { }

  onNewTrackDetected() {
    if (!Settings.enableRules) {
      return;
    }
    const rule = this.findMatchingGenreRule();
    if (!rule) {
      return;
    }
    const mode = HqpConfigModel.normalizeMode(Model.status.data['@_active_mode']) || 'PCM';
    const arr = Settings.getPresetsArray(mode);
    const presetIndex = parseInt(rule.presetIndex);
    const preset = arr[presetIndex];
    if (!preset || !PresetUtil.doesPresetHaveValues(preset)) {
      return;
    }
    PresetUtil.applyPresetAndResume(preset, Model.playlist.currentIndex + 1);
  }

  findMatchingGenreRule() {
    const albumGenres = this.getCurrentTrackGenres();
    if (!albumGenres || albumGenres.length === 0) return null;

    const rules = Settings.genreRules;
    for (const rule of rules) {
      if (rule.genre) {
        const ruleGenre = rule.genre.toLowerCase();
        for (const ag of albumGenres) {
          if (ag === ruleGenre) {
            return rule;
          }
        }
      }
    }
    return null;
  }

  getCurrentTrackGenres() {
    const metadata = Model.status.metadata;
    if (!metadata || !metadata['@_hash']) return null;

    const album = Model.library.getAlbumByTrackHash(metadata['@_hash']);
    if (!album) return null;

    return AppUtil.splitGenreString(album['@_genre']);
  }
}

export default new PresetRuleApplier()
