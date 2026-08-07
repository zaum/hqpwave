import Util from './util.js';
import Model from './model.js';
import DataUtil from './data-util.js';
import PresetUtil from './preset-util.js';
import Commands from './commands.js';
import Service from './service.js';

/**
 * Owns hqplayer upscaling-related array data (modes, filters, shapers).
 * Plus higher-level service logic.
 */
class HqpConfigModel {

  constructor() {
    this.MODE_PCM = 'PCM';
    this.MODE_DSD = 'DSD';
    this.MODE_SOURCE = 'source';
    this.PCM_MULTIPLE_A = 44100;
    this.PCM_MULTIPLE_B = 48000;
    this.MODE_ALIASES = { 'SDM': 'DSD', '[source]': 'source' };
    this.modesArray = [];
    this.filtersData = {};
    this.shapersData = {};
    this.ratesData = {};
    this.pcmFsMultiples = [1];
    this._lookup = (array, key1, value, key2) => {
      for (let o of array ) {
        if (o[key1] == value) {
          return o[key2];
        }
      }
      return null;
    };
  }

  /** Returns the non-PCM mode name from modesArray, or 'DSD' as fallback */
  get dsdModeName() {
    if (this.modesArray) {
      for (const m of this.modesArray) {
        if (m['@_name'] !== 'PCM') return m['@_name'];
      }
    }
    return 'DSD';
  }

  /** Returns true if the given mode name is the DSD/SDM mode */
  isDsmMode(name) {
    if (!name) return false;
    return name !== this.MODE_PCM && name !== this.MODE_SOURCE;
  }

  /** Normalizes a mode name to its canonical form */
  normalizeMode(name) {
    if (!name) return this.MODE_PCM;
    const m = String(name);
    if (m.startsWith('SDM')) return this.MODE_DSD;
    return this.MODE_ALIASES[m] || m;
  }

  /** @returns index, which is a string */
  getModeIndex(modeName) {
    return this._lookup(this.modesArray, '@_name', modeName, '@_index');
  }

  /** @returns index, which is a string */
  getFilterIndex(modeName, filterName) {
    const a = this.filtersData[modeName];
    if (!a) {
      return null;
    }
    return this._lookup(a, '@_name', filterName, '@_index');
  }

  /** @returns index, which is a string */
  getShaperIndex(modeName, shaperName) {
    const a = this.shapersData[modeName];
    if (!a) {
      return null;
    }
    return this._lookup(a, '@_name', shaperName, '@_index');
  }

  /**
   * Updates modes array plus filters/shapers/rates arrays (as needed).
   */
  updateData(callback) {
    this.getModes(() => this.getFiltersShapersRates(callback));
  }

  /**
   * Gets modes array (if needed) and calls back.
   */
  getModes(callback) {
    if (this.modesArray && this.modesArray.length > 0) {
      callback();
      return;
    }
    Service.queueCommandFront(Commands.getModes(), (data) => {
      const a = DataUtil.getArrayFrom(data, 'GetModes', 'ModesItem'); // note 'ModesItem' (plural)
      // Normalize alternative mode names
      for (let i = 0; i < a.length; i++) {
        const n = a[i]['@_name'];
        const normalizedName = this.normalizeMode(n);
        if (normalizedName !== n) {
          a[i]['@_name'] = normalizedName;
        }
      }
      this.modesArray = a;
      callback();
    });
  }

  /**
   * Gets the filters, shapers, and rates arrays (if needed),
   * and calls back. Rem, these arrays are specific to the current mode.
   *
   * @param callback(isSuccess)
   */
  getFiltersShapersRates(callback) {

    const modeFromStatus = () => this.normalizeMode(Model.status.data['@_active_mode']);

    const onGetFilters = (data) => {
      const a = DataUtil.getArrayFrom(data, 'GetFilters', 'FiltersItem');
      this.filtersData[modeFromStatus()] = a;
    };
    const onGetShapers = (data) => {
      const a = DataUtil.getArrayFrom(data, 'GetShapers', 'ShapersItem');
      this.shapersData[modeFromStatus()] = a;
    };
    const onGetRatesAndFinish = (data) => {
      const a = DataUtil.getArrayFrom(data, 'GetRates', 'RatesItem');
      // Special case: Remove entry with '0'
      for (let i = 0; i < a.length; i++) {
        if (a[i]['@_rate'] === '0') {
          a.splice(i, 1);
          break;
        }
      }
      const modeName = modeFromStatus();
      this.ratesData[modeName] = a;
      if (modeName == this.MODE_PCM) {
        this.initPcmFsMultiples();
      }
      $(document).trigger('upscaling-data-updated', modeName);
      callback(); // done
    };

    const step2 = () => {

      const modeName = modeFromStatus();
      let b = true;
      b = b && (this.filtersData[modeName] && this.filtersData[modeName].length > 0);
      b = b && (this.shapersData[modeName] && this.shapersData[modeName].length > 0);
      b = b && (this.ratesData[modeName] && this.ratesData[modeName].length > 0);
      if (b) {
        callback(true);
        return;
      }

      Service.queueCommandsFront([
        { xml: Commands.getFilters(), callback: onGetFilters },
        { xml: Commands.getShapers(), callback: onGetShapers },
        { xml: Commands.getRates(), callback: onGetRatesAndFinish }
      ]);
    };

    // step1: Refresh status bc mode may have just been changed.
    Service.queueCommandFront(Commands.status(), step2);
  }

  /**
   * Parses pcm rates array to get 'fs' ('full scale') multiples
   * (eg, [1,2,4,8,16])
   */
  initPcmFsMultiples() {

    if (!this.ratesData || !this.ratesData[this.MODE_PCM]) {
      cl('warning no pcm rates array');
      return;
    }
    const a = this.ratesData[this.MODE_PCM];

    // Making assumption that hqp rate elements are nonrepeating and in ascending order.
    // Making hardcoded assumption about the rate multiples.
    const arrayA = [];
    const arrayB = [];
    for (let item of a) {
      const rateString = item['@_rate'];
      const rateInt = parseInt(rateString);
      if (isNaN(rateInt)) {
        cl('warning rate string doesnt parse', rateString);
        continue;
      }
      const multipleA = rateInt / this.PCM_MULTIPLE_A;
      const multipleB = rateInt / this.PCM_MULTIPLE_B;
      if (multipleA == Math.floor(multipleA)) {
        arrayA[multipleA] = true;
      } else if (multipleB == Math.floor(multipleB)) {
        arrayB[multipleB] = true;
      }
    }

    this.pcmFsMultiples = [];
    const max = Math.max(arrayA.length, arrayB.length);
    for (let i = 0; i <= max; i++) {
      if (arrayA[i] && arrayB[i]) {
        this.pcmFsMultiples.push(i);
      } else if (!arrayA[i] && !arrayB[i]) {
        // fine makes sense
      } else {
        cl('warning unexpected discrepancy', arrayA, arrayB);
      }
    }
  }
}

export default new HqpConfigModel();