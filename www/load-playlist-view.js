import AppUtil from './app-util.js';
import Commands from './commands.js';
import LoadPlaylistContextMenu from './load-playlist-context-menu.js';
import MetaUtil from './meta-util.js';
import ModalPointerUtil from './modal-pointer-util.js';
import Model from './model.js';
import DataUtil from './data-util.js';
import PlaylistVo from './playlist-vo.js';
import Service from './service.js';
import Subview from './subview.js';
import ToastView from './toast-view.js';
import Util from './util.js';
import Values from './values.js';
import ViewUtil from './view-util.js';

const PLAYLIST_LOAD_TIMEOUT_MS = 12000;

/**
 * Shows list of custom playlists.
 */
export default class LoadPlaylistView  extends Subview {

  $customList;
  $hqpList;

  items;
  contextMenu;

  customPlaylistPaths;
  hqpPlaylistItems;
  loadTimeoutId = null;
  loadSessionId = 0;
  isLoading = false;

  constructor($el) {
  	super($el);
  	this.$customList = this.$el.find("#loadCustomList");
    this.$hqpList = this.$el.find("#loadHqpList");
  	this.$el.find("#loadCloseButton").on("click tap", () => $(document).trigger('load-playlist-close'));
    this.contextMenu = new LoadPlaylistContextMenu();
	}

  onShow() {
    this.$el[0].scrollTop = 0;
    $(document).on('custom-playlists-changed', this.onMetaPlaylistsChanged);
    $(document).on('server-errors', this.onServerErrors);
    $(document).on('proxy-errors', this.onProxyErrors);
    this.populate();
  }

  onHide() {
    $(document).off('custom-playlists-changed', this.onMetaPlaylistsChanged);
    $(document).off('server-errors', this.onServerErrors);
    $(document).off('proxy-errors', this.onProxyErrors);
  }

  populate() {
    this.fetchCustomPlaylistPaths((isSuccess) => {
      if (!isSuccess) {
        ToastView.show(`<span class="colorAccent">Couldn't get custom playlists</span>`); // todo continue
      } else {
        this.populateCustomList();
        this.populateHqpList();
      }
    });
  }
  
  populateCustomList() {
    this.$customList.empty();
    const $header = this.$el.find('.loadListCustomSubheader');
    if (Values.areOnDifferentMachines) {
      this.$customList.append(this.makeFyiCustomItem());
      $header.hide();
      return;
    }
    if (this.customPlaylistPaths.length == 0) {
      // no custom playlists: hide header and show nothing
      $header.hide();
      return;
    }
    $header.show();
    for (let i = 0; i < this.customPlaylistPaths.length; i++) {
      const playlist = this.customPlaylistPaths[i];
      const $item = this.makeCustomListItem(playlist, i);
      this.$customList.append($item);
      $item.on('click tap', this.onCustomItemClick);
      // wire delete button on the right to perform delete (stop propagation so row click doesn't fire)
      $item.find('.deleteButton').on('click tap', (e) => {
        e.stopPropagation();
        const idx = parseInt($(e.currentTarget).attr('data-index'));
        const playlistUri = this.customPlaylistPaths[idx];
        this.contextMenu.playlistUri = playlistUri;
        this.contextMenu.index = idx;
        this.contextMenu.doDelete();
      });
    }
  }

  makeCustomListItem(customPlaylistPath, index) {
    let name = Util.getFilenameFromPath(customPlaylistPath);
    name = name.replace('.m3u8', '');
    let s = '';
    s += `<div class="trackItem loadItem" data-index="${index}">`;
    s += `<div class="loadItemName">${name}</div>`;
    s += `  <div class="right"><div class="iconButton deleteButton" data-index="${index}"></div></div>`;
    s += `</div>`;
    return $(s);
  }

  populateHqpList() {

    this.hqpPlaylistItems = [...Model.library.hqpPlaylistItems];

    this.$hqpList.empty();
    if (this.hqpPlaylistItems.length == 0) {
      this.$hqpList.append(this.makeNonItem());
      return;
    }
    for (let i = 0; i < this.hqpPlaylistItems.length; i++) {
      const item = this.hqpPlaylistItems[i];
      const $item = this.makeHqpListItem(item, i);
      this.$hqpList.append($item);
      $item.on('click tap', this.onHqpItemClick);
      $item.find(".moreButton").on("click tap", e => this.onItemContextButtonClick(e));
    }
  }

  makeHqpListItem(hqpPlaylistItem, index) {
    let s = '';
    s += `<div class="trackItem loadItem" data-index="${index}" style="padding-right:12px; overflow:hidden;">`;
    s += `<span>${hqpPlaylistItem['@_album']}</span>`;
    s += `</div>`;
    return $(s);
  }

  makeNonItem() {
    const s = `<div class="trackItem loadItem loadNonItem">No playlists</div>`;
    return $(s);
  }

  makeFyiCustomItem() {
    const s = `<div class="trackItem loadItem loadNonItem loadFyiItem">HQPWV and HQPlayer must be running on the same machine for custom playlists to be enabled.</div>`;
    return $(s);
  }

  decodePlaylistPath(path) {
    if (!path || typeof path !== 'string') {
      return '';
    }
    const result = Util.decodeXmlEntities(path).trim();
    if (!result) {
      return '';
    }
    if (/^file:/i.test(result)) {
      return Util.toComparableLocalPath(result);
    }
    return result;
  }

  makeTransportPathCandidates(path) {
    const raw = (typeof path === 'string') ? path.trim() : '';
    const decoded = this.decodePlaylistPath(raw);
    const comparablePath = Util.toComparableLocalPath(decoded || raw);

    const values = [];
    const add = (value) => {
      if (!value || typeof value !== 'string') {
        return;
      }
      const v = value.trim();
      if (!v || values.includes(v)) {
        return;
      }
      values.push(v);
    };

    add(raw);
    add(decoded);
    add(comparablePath);

    const noFilePrefix = comparablePath || decoded.replace(/^file:\/\//i, '');
    add(noFilePrefix);

    const slashPath = noFilePrefix.replace(/\\/g, '/');
    add(slashPath);
    if (/^[a-zA-Z]:\//.test(slashPath) || slashPath.startsWith('//')) {
      add(slashPath.replace(/\//g, '\\'));
    }

    // Some HQPlayer builds accept file:// URI form, others prefer local path.
    add(`file://${noFilePrefix}`);
    add(`file:///${slashPath.replace(/^\/+/, '')}`);
    add(Util.makeFileUri(decoded || raw));

    return values;
  }

	onCustomItemClick = (e) => {
    const $item = $(e.currentTarget);
    const index = parseInt($item.attr('data-index'));
    const path = this.customPlaylistPaths[index];
    this.doPlaylistLoad(path);
  };

  onHqpItemClick = (e) => {
    const $item = $(e.currentTarget);
    const index = parseInt($item.attr('data-index'));
    const item = this.hqpPlaylistItems[index];
    const path = this.decodePlaylistPath(item['@_path']);
    this.doPlaylistLoad(path);
  };

  // ---

  doPlaylistLoad(path) {
    path = this.decodePlaylistPath(path);

    this.loadSessionId += 1;
    const sessionId = this.loadSessionId;
    this.isLoading = true;

    // Defer showing the 'Loading' toast until we have confirmed transport
    // so we avoid flashing 'Loading' when the load will immediately fail.
    $(document).trigger('disable-user-input');

    if (this.loadTimeoutId) {
      clearTimeout(this.loadTimeoutId);
    }
    this.loadTimeoutId = setTimeout(() => {
      if (sessionId !== this.loadSessionId) {
        return;
      }
      this.finishLoad(false, 'Load timed out');
    }, PLAYLIST_LOAD_TIMEOUT_MS);

    const onGetTransport = (data) => {
      if (data['GetTransport'] == undefined || data['GetTransport']['@_value'] == undefined) {
        cl('warning bad value', data);
        this.finishLoad(false, `Couldn't load playlist`);
      } else {
        let transport = data['GetTransport']['@_value'];
        // Now that we have transport info, show the indefinite loading toast
        ToastView.show(`Loading playlist`, 0);
        if (transport == 0) {
          // Can happen when playlist is empty;
          // 240 is what it otherwise returns based on personal testing
          cl('warning value is 0, will use 240');
          transport = 240;
        }
        this.doPlaylistLoadContinued(path, transport);
      }
    };

    // no idea what this but info is needed for <SetTransport>
    Service.queueCommandFront(Commands.getTransport(), onGetTransport);
  }

  doPlaylistLoadContinued(path, transport) {
    const candidates = this.makeTransportPathCandidates(path);
    let candidateIndex = 0;

    const onLoaded = () => {
      Values.bumpCoverCacheKey();

      // HQPlayer returns OK immediately but processes the new playlist
      // asynchronously. Delay PlaylistGet so the model gets the NEW data
      // before we transition back.
      const sessionId = this.loadSessionId;
      setTimeout(() => {
        if (sessionId !== this.loadSessionId) return;
        Service.queueCommandFront(Commands.playlistGet(), () => {
          if (sessionId !== this.loadSessionId) return;
          this.finishLoad(true);
        });
      }, 400);
    };

    const tryNextCandidate = () => {
      if (candidateIndex >= candidates.length) {
        this.finishLoad(false, `Couldn't load playlist`);
        return;
      }

      const candidatePath = candidates[candidateIndex++];
      const command = Commands.setTransport(transport, candidatePath);
      Service.queueCommandFront(command, (data) => {
        if (DataUtil.isResultOk(data)) {
          onLoaded();
          return;
        }
        tryNextCandidate();
      });
    };

    tryNextCandidate();
  }

  finishLoad(isSuccess, message = null) {
    if (!this.isLoading) {
      return;
    }
    this.isLoading = false;

    if (this.loadTimeoutId) {
      clearTimeout(this.loadTimeoutId);
      this.loadTimeoutId = null;
    }

    $(document).trigger('enable-user-input');

    if (isSuccess) {
      ToastView.hide();
      $(document).trigger('load-playlist-close');
    } else {
      // Show error directly (don't call hide() first — the indefinite
      // "Loading" toast's min-duration delayed-hide would clobber the error)
      if (message) {
        ToastView.show(`${message}`, 2500);
      } else {
        ToastView.hide();
      }
      // Stay on Load view so user can retry
    }
  }

  onServerErrors = () => {
    this.finishLoad(false, 'Server not responding');
  };

  onProxyErrors = () => {
    this.finishLoad(false, 'Server error');
  };

  onItemContextButtonClick(event) {
    event.stopPropagation(); // prevent listitem from responding to same event
    const $button = $(event.currentTarget);
    const index = parseInt($button.attr("data-index"));
    const playlistUri = this.customPlaylistPaths[index];
    this.contextMenu.show(this.$el, $button, playlistUri, index);
  }

  onMetaPlaylistsChanged = () => {
    this.contextMenu.hide();
    this.populate();
  };

  // ---

  fetchCustomPlaylistPaths(resultCallback) {
    const onSuccess = (data, textStatus, jqXHR) => {
      if (!!data['error']) {
        cl('warning', data['error']);
        this.customPlaylistPaths = [];
        resultCallback(false);
        return;
      }
      this.customPlaylistPaths = data;
      resultCallback(true);
    };
    const onError = (e) => {
      cl('warning', e);
      this.customPlaylistPaths = [];
      resultCallback(false);
    };
    const url = `${Values.PLAYLIST_ENDPOINT}?getPlaylists`;
    $.ajax( { url: url, error: onError, success: onSuccess } );
  }
}
