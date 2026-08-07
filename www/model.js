import Commands from './commands.js';
import StatusVo from './status-vo.js';
import StateVo from './state-vo.js';
import LibraryVo from './library-vo.js';
import PlaylistVo from './playlist-vo.js';

/**
 * Model
 * Data comes from hqp and is json-converted by the webserver.
 */
class Model {

  constructor() {
    this._library = new LibraryVo();
    this._status = new StatusVo();
    this._lastStatus = new StatusVo();
    this._state = new StateVo();
    this._playlist = new PlaylistVo();
    this._infoData = {};
  }

  // @NonNull
	get library() {
		return this._library;
	}

	setLibraryDataUsingResponseObject(data) {
		this._library = new LibraryVo(data);
		$(document).trigger('model-library-updated');
    this.hasLibrary = true;
	}

  // @NonNull
	get status() {
		return this._status;
	}

  // @NonNull
  get lastStatus() {
    return this._lastStatus;
  }

	setStatusUsingResponseObject(data) {
		this._lastStatus = this._status;
    this._status = new StatusVo(data);
		$(document).trigger('model-status-updated');
	}

  // @NonNull
  get state() {
    return this._state;
  }

  setStateUsingResponseObject(data) {
    this._state = new StateVo(data);
    $(document).trigger('model-state-updated');
  }

  // @NonNull
	get playlist() {
		return this._playlist;
	}

	setPlaylistDataUsingResponseObject(data) {
    this._playlist = new PlaylistVo(data);
		$(document).trigger('model-playlist-updated');
	}

  get infoData() {
    return this._infoData;
  }

  setInfoUsingResponseObject(data) {
    this._infoData = data['GetInfo'] ? data['GetInfo'] : {};
    $(document).trigger('model-info-updated');
  }
}

// Singleton
export default new Model();