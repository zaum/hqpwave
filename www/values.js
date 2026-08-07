import Util from './util.js';

/**
 * Various global values.
 */
class Values {

  constructor() {
    this.EXCLUDED_ARTISTS = ['various', 'various artists', 'va', 'v.a.', 'unknown', 'multiple artists', 'multiple', 'miscellaneous', 'misc', 'compilation'];
    this.PROJECT_URL = 'http://https://github.com/zaum/hqpwave';
    this.TROUBLESHOOTING_HREF = 'https://github.com/zaum/hqpwave/blob/master/readme_enduser.md';
    this.ENDPOINTS_BASE_URL = window.location.origin + '/endpoints/';
    this.COMMAND_ENDPOINT = this.ENDPOINTS_BASE_URL + "command";
    this.NATIVE_ENDPOINT = this.ENDPOINTS_BASE_URL + 'native';
    this.META_ENDPOINT = this.ENDPOINTS_BASE_URL + 'meta';
    this.META_DOWNLOAD_LINK = this.ENDPOINTS_BASE_URL + 'meta?getDownload';
    this.PLAYLIST_ENDPOINT = this.ENDPOINTS_BASE_URL + 'playlist';
    this.LYRICS_ENDPOINT = this.ENDPOINTS_BASE_URL + 'lyrics';
    this._hqpwvVersion = '';
    this._startTime = new Date().getTime();
    this._coverCacheKey = Date.now();
  }

  setValues(nativeGetInfoData) {
    this._hqpwvVersion = nativeGetInfoData['hqpwv_version'];
    this._hqpwvIp = nativeGetInfoData['server_ip_address'];
    this._hqplayerIp = nativeGetInfoData['hqplayer_ip_address'];
    this._imagesEndpoint = 'http://' + this._hqplayerIp + ':8088' + '/cover/';
  }

  get hqpwvVersion() {
    return this._hqpwvVersion;
  }

  get hqpwvIp() {
    return this._hqpwvIp;
  }

  get hqplayerIp() {
    return this._hqplayerIp;
  }

  get areOnDifferentMachines() {
    return (this._hqpwvIp != this._hqplayerIp);
  }

  get imagesEndpoint() {
    return this._imagesEndpoint;
  }

  get coverCacheKey() {
    return this._coverCacheKey;
  }

  bumpCoverCacheKey() {
    this._coverCacheKey = Date.now();
  }

  get uptimeString() {
    const delta = new Date().getTime() - this._startTime;
    return Util.makeCasualSecondsString(delta);
  }
}

export default new Values();
