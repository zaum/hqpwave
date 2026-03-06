import Util from './util.js';
import ViewUtil from './view-util.js';
import ModalPointerUtil from './modal-pointer-util.js';
import Model from './model.js';
import DataUtil from './data-util.js';
import Commands from './commands.js';
import Service from './service.js';
import ProgressView from './progress-view.js';
import CircularProgress from './circular-progress.js';
import VolumePanel from './volume-panel.js';

/**
 * Library view containing a list of albums.
 */
export default class PlaybarView {
  
  $el;
  $cover;
  $coverImg;
  progressView;
  volumePanel;
  $volumeInline;
  $volumeInlineTrack;
  $volumeInlineThumb;
  $volumeInlineText;
  $volumeToggle;
  pointerUtil;

  totalTracks = -1;
  atTrack = -1;
  state = '';

  playingText;
  systemMessageText;
  currentSecondsText;
  totalSecondsText;
  ratio;
  isVolumePanelShowing = false;
  _coverUrl = '';

  constructor() {
    this.$el = $("#playbarView");
    this.$cover = this.$el.find('#playbarCover');
    this.$coverImg = this.$el.find('#playbarCoverImg');

    // Rem, button states are mostly governed by css classes on root view.
    this.$playButton = this.$el.find("#playButton");
    this.$playButtonContainer = this.$el.find("#playButtonContainer");
    this.$stopButton = this.$el.find("#stopButton");
    this.$previousButton = this.$el.find("#previousButton");
    this.$nextButton = this.$el.find("#nextButton");
    this.$seekBackwardButton = this.$el.find('#seekBackwardButton');
    this.$seekForwardButton = this.$el.find('#seekForwardButton');

    this.$playingText = this.$el.find("#playingText");
    this.$systemMessage = $("#playbarSystemMessage");
    this.$trackCurrentTime = this.$el.find(".playingTrackCurrentTime");
    this.showRemaining = false;
    this.$trackCurrentTime.on('click tap', () => {
      if (window.innerWidth < 768) {
        this.showRemaining = !this.showRemaining;
        this._updateCurrentSeconds();
      }
    });
    this.$trackLength = this.$el.find("#playingTrackLength");
    this.$showPlaylistButton = this.$el.find("#showPlaylistButton");
    this.$playlistNumberAt = this.$el.find("#playlistNumberAt");
    this.$playlistNumberTotal = this.$el.find("#playlistNumberTotal");
    this.$volumeInline = this.$el.find('#volumeInline');
    this.$volumeInlineTrack = this.$el.find('#volumeInlineTrack');
    this.$volumeInlineThumb = this.$el.find('#volumeInlineThumb');
    this.$volumeInlineText = this.$el.find('#volumeInlineText');
    this.$volumeToggle = this.$el.find('#volumeMobileToggle');

    this.progressView = new ProgressView();
    this.volumePanel = new VolumePanel(this.$el.find('#volumePanel'));

    // Circular progress for mobile
    this.circularProgress = null;
    this._initCircularProgress();

    this.$playButton.on('click tap', this.onPlayButton);
    this.$stopButton.on('click tap', () => Service.queueCommandFrontAndGetStatus(Commands.stop()));
    this.$previousButton.on("click tap", this.onPreviousButton);
    this.$nextButton.on("click tap", this.onNextButton);
    this.$seekBackwardButton.on("click tap", () => this.seekBySeconds(-10));
    this.$seekForwardButton.on("click tap", () => this.seekBySeconds(10));

    this.$showPlaylistButton.on("click tap", () => $(document).trigger('playbar-show-playlist'));
    this.$playingText.on("click tap", () => $(document).trigger('playbar-show-playlist'));
    this.$cover.on("click tap", this.onCoverClick);
    this.$volumeInlineTrack.on('click tap', this.onVolumeTrackClick);
    this.$volumeInlineTrack.on('mousedown touchstart', this.startVolumeDrag);
    this.$volumeToggle.on('click tap', this.onVolumeToggleClick);

    Util.addAppListener(this, 'model-playlist-updated', this.onModelPlaylistUpdated);
    Util.addAppListener(this, 'model-status-updated', this.onModelStatusUpdated);
    Util.addAppListener(this, 'model-state-updated', this.onModelStateUpdated);
    Util.addAppListener(this, 'progress-thumb-drag', this.onProgressThumbDrag);

    this.pointerUtil = new ModalPointerUtil(
        [this.$volumeInline, this.$volumeToggle, this.volumePanel.$el],
        () => {
          this.hideVolumePopup();
          this.hideVolumePanel();
        });
  }

  _initCircularProgress() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const createCircular = () => {
      if (!this.circularProgress) {
        this.circularProgress = new CircularProgress(this.$playButtonContainer, {
          size: 56, // larger, to provide spacing
          stroke: 4
        });
      }
    };
    const destroyCircular = () => {
      if (this.circularProgress) {
        this.circularProgress.destroy();
        this.circularProgress = null;
      }
    };
    if (isMobile) {
      createCircular();
    } else {
      destroyCircular();
    }
    window.addEventListener('resize', () => {
      const nowMobile = window.matchMedia('(max-width: 768px)').matches;
      if (nowMobile) {
        createCircular();
      } else {
        destroyCircular();
      }
    });
  }

  get $el() {
  	return this.$el;
  }

  update() {
    this._updatePlayingText();
    this._updateThumb();
    this._updateCurrentSeconds();
    this._updateTotalSeconds();
    this._updatePlaylistNumbers();

    // Update circular progress if present
    if (this.circularProgress && typeof this.ratio === 'number') {
      this.circularProgress.setProgress(this.ratio);
    }
    /*
    also:
    @_track_serial - ?
    @_begin_min, @_begin_sec - ints; how is this different from min/sec?
    @_queued - not sure; was 0
    */
  }

  /**
   * Updates the at-track number and total-tracks number.
   * Relies on both Model.status and Model.playlist.
   */
  _updatePlaylistNumbers() {
    // nb: status has a totaltracks property but appears to be bugged so not using
    // nb also: status.track is not correct when track is changed while in paused state.

    const totalTracks = Model.playlist.array.length;
    const atTrack = Model.playlist.currentIndex;
    if (totalTracks == this.totalTracks && atTrack == this.atTrack) {
      return;
    }
    this.totalTracks = totalTracks;
    this.atTrack = atTrack;
    this.$playlistNumberAt.text(atTrack + 1);
    this.$playlistNumberTotal.text(this.totalTracks);
  }

  /**
   * Updates the 'now playing' text line.
   * Relies on both Model.status and Model.playlist.
   */
  _updatePlayingText() {
    let artist = '&nbsp;';
    let title = '&nbsp;';
    let systemMessage = '';
    if (Model.status.isStopped) {
      if (Model.playlist.array.length <= 0) {
        systemMessage = 'Playlist is empty';
      } else {
        // Show first playlist item info if available
        const first = Model.playlist.array[0];
        if (first) {
          const artistText = (first['@_artist'] || '').trim();
          if (artistText) {
            artist = artistText;
          }
          let song = '';
          if (first['@_song']) {
            if (Util.areUriAndPathEquivalent(first['@_song'], first['@_uri'])) {
              song = Util.getFilenameFromPath(first['@_song']);
            } else {
              song = first['@_song'];
            }
          }
          song = (song || '').trim();
          if (song) {
            title = song;
          }
          if (!artistText && !song) {
            title = '&nbsp;';
          }
        }
      }
    } else {
      const meta = Model.status.metadata;
      const artistText = (meta['@_artist'] || '').trim();
      if (artistText) {
        artist = artistText;
      }

      let song = '';
      if (meta['@_song']) {
        if (Util.areUriAndPathEquivalent(meta['@_song'], meta['@_uri'])) {
          song = Util.getFilenameFromPath(meta['@_song']);
        } else {
          song = meta['@_song'];
        }
      }
      song = (song || '').trim();
      if (song) {
        title = song;
      }

      if (!artistText && !song) {
        title = '&nbsp;';
      }
    }

    const s = `<div class="playingArtist">${artist}</div><div class="playingTitle">${title}</div>`;
    if (this.playingText != s) {
      this.playingText = s;
      this.$playingText.html(this.playingText);
    }

    this._updateSystemMessage(systemMessage);
  }

  _updateSystemMessage(message) {
    if (!this.$systemMessage || this.$systemMessage.length <= 0) {
      return;
    }

    const text = message || '';
    if (this.systemMessageText === text) {
      return;
    }
    this.systemMessageText = text;

    if (!text) {
      this.$systemMessage.text('');
      this.$systemMessage.removeClass('isVisible');
      return;
    }

    this.$systemMessage.text(text);
    this.$systemMessage.addClass('isVisible');
  }

  seekBySeconds(deltaSeconds) {
    if (!deltaSeconds || Model.status.isStopped) {
      return;
    }

    const currentSeconds = (Model.status.seconds == -1) ? 0 : Model.status.seconds;
    const totalSeconds = (Model.status.totalSeconds == -1) ? 0 : Model.status.totalSeconds;

    let targetSeconds = currentSeconds + deltaSeconds;
    targetSeconds = Math.max(0, targetSeconds);
    if (totalSeconds > 0) {
      targetSeconds = Math.min(totalSeconds, targetSeconds);
    }

    Service.queueCommandFrontAndGetStatus(Commands.seek(Math.round(targetSeconds)));
  }

  _updateThumb() {
    const seconds = (Model.status.position == -1) ? 0 : Model.status.position;
    const totalSeconds = (Model.status.totalSeconds == -1) ? 0 : Model.status.totalSeconds;
    let ratio = seconds / totalSeconds;
    if (isNaN(ratio)) {
      ratio = 0;
    }
    this.ratio = ratio;
    this.progressView.update(ratio, seconds);
  }

  _updateCurrentSeconds() {
    let seconds = (Model.status.seconds == -1) ? 0 : Model.status.seconds;
    let total = (Model.status.totalSeconds == -1) ? 0 : Model.status.totalSeconds;
    let s;
    if (this.showRemaining && total > 0) {
      let rem = total - seconds;
      if (rem < 0) rem = 0;
      s = '-' + Util.durationText(rem);
    } else {
      s = Util.durationText(seconds);
    }
    if (this.currentSecondsText == s) {
      return;
    }
    this.currentSecondsText = s;
    this.$trackCurrentTime.text(this.currentSecondsText);
  }

  _updateTotalSeconds() {
    const seconds = (Model.status.totalSeconds == -1) ? 0 : Model.status.totalSeconds;
    const s = (seconds == -1) ? '--:--' : Util.durationText(seconds);
    if (this.totalSecondsText == s) {
      return;
    }
    this.totalSecondsText = s;
    this.$trackLength.text(this.totalSecondsText);
  }

  _updatePreviousNextButtons() {
    // rem, classes on page holder also inform disabledness as well
    if (Model.playlist.isOnFirstTrack) {
      this.$previousButton.addClass('isDisabled');
    }  else {
      this.$previousButton.removeClass('isDisabled');
    }

    const isRepeat = (Model.state.isRepeatAll || Model.state.isRepeatOne);
    if (Model.playlist.isOnLastTrack && !isRepeat) {
      this.$nextButton.addClass('isDisabled');
    }  else {
      this.$nextButton.removeClass('isDisabled');
    }
  }

  showVolumePanel() {
    if (this.isVolumePanelShowing) {
      return;
    }
    this.isVolumePanelShowing = true;
    this.$volumeToggle.addClass('isSelected');
    this.showVolumePopup();
    this.volumePanel.show();
    this.pointerUtil.start();
  }

  hideVolumePanel() {
    this.isVolumePanelShowing = false;
    this.$volumeToggle.removeClass('isSelected');
    this.hideVolumePopup();
    this.volumePanel.hide();
    this.pointerUtil.clear();
  }

  showVolumePopup() {
    this.positionVolumePopup();
    this.$el.addClass('isVolumePopupOpen');
    this.$volumeToggle.addClass('isSelected');
  }

  hideVolumePopup() {
    this.$el.removeClass('isVolumePopupOpen');
    this.$volumeToggle.removeClass('isSelected');
  }

  positionVolumePopup() {
    if (!this.$volumeInline || this.$volumeInline.length <= 0 || !this.$volumeToggle || this.$volumeToggle.length <= 0) {
      return;
    }
    const parent = this.$volumeInline.parent();
    if (!parent || parent.length <= 0) {
      return;
    }

    const parentRect = parent[0].getBoundingClientRect();
    const toggleRect = this.$volumeToggle[0].getBoundingClientRect();
    const centerX = (toggleRect.left + (toggleRect.width / 2)) - parentRect.left;
    this.$volumeInline.css('left', `${centerX}px`);
  }

  toggleVolumePopup() {
    if (this.$el.hasClass('isVolumePopupOpen')) {
      this.hideVolumePopup();
      this.pointerUtil.clear();
      return;
    }
    this.showVolumePopup();
    this.pointerUtil.start();
  }

  onModelStatusUpdated(e) {
    this._updatePlayingText();
    if (!this.progressView.isDragging) {
      this._updateThumb();
      this._updateCurrentSeconds();
    }
    this._updateTotalSeconds();
    this._updatePlaylistNumbers();
    this._updatePreviousNextButtons();
    this._updateMusicPlayingAnimation();
    this._updateVolumeInline();
    this._updateCoverArt();
  }

  onModelPlaylistUpdated(e) {
    this._updatePlaylistNumbers();
    this._updatePreviousNextButtons();
    this._updateCoverArt();
    this._updatePlayingText();
  }

  onModelStateUpdated(e) {
    this._updatePreviousNextButtons();
  }

  onPlayButton = (e) => {
    const xml = Model.status.isPlaying ? Commands.pause() : Commands.play();
    Service.queueCommandFrontAndGetStatus(xml);
  };

  onPreviousButton = (e) => {
    Service.queueCommandFrontAndGetStatus(Commands.previous());
  };

  onNextButton = (e) => {
    Service.queueCommandFrontAndGetStatus(Commands.next());
  };

  onProgressThumbDrag() {
    // Update current seconds text based on thumb's current position ratio
    // (during the course of the drag gesture only)
    const seconds = Model.status.getSecondsFromRatio(this.progressView.dragRatio);
    const s = Util.durationText(seconds);
    this.$trackCurrentTime.text(s);
  }

  onVolumeTrackClick = (e) => {
    const trackWidth = this.$volumeInlineTrack.width();
    const trackHeight = this.$volumeInlineTrack.height();
    if (!trackWidth || !trackHeight) {
      return;
    }
    const offset = this.$volumeInlineTrack.offset();
    const touchPoint = (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0])
      ? e.originalEvent.touches[0]
      : null;
    const clientX = (e.clientX !== undefined) ? e.clientX : (touchPoint ? touchPoint.clientX : null);
    const clientY = (e.clientY !== undefined) ? e.clientY : (touchPoint ? touchPoint.clientY : null);
    const isVertical = window.matchMedia('(max-width: 1024px)').matches;

    let ratio;
    if (isVertical) {
      if (clientY === null) {
        return;
      }
      ratio = (offset.top + trackHeight - clientY) / trackHeight;
    } else {
      if (clientX === null) {
        return;
      }
      ratio = (clientX - offset.left) / trackWidth;
    }

    if (isNaN(ratio)) {
      return;
    }
    ratio = Math.max(0, Math.min(1, ratio));

    const current = Model.status.volume;
    if (isNaN(current)) {
      return;
    }
    const target = Math.round((ratio * 80) - 40); // map 0–1 to approx -40..+40 dB
    const delta = target - current;
    if (delta === 0) {
      return;
    }
    const step = delta > 0 ? 1 : -1;
    const steps = Math.min(6, Math.abs(Math.round(delta))); // clamp to avoid huge bursts

    const command = step > 0 ? Commands.volumeUp() : Commands.volumeDown();
    const commands = [];
    for (let i = 0; i < steps; i++) {
      commands.push(command);
    }
    commands.push(Commands.status());
    Service.queueCommandsFront(commands);
  };

  onVolumeToggleClick = (e) => {
    this.toggleVolumePopup();
  };

  _updateMusicPlayingAnimation() {
    const $musicPlaying = this.$el.find("#musicPlaying");
    const shouldAnimate = Model.status.isPlaying && !Model.status.isStopped;
    if (shouldAnimate) {
      $musicPlaying.addClass("isPlaying");
    } else {
      $musicPlaying.removeClass("isPlaying");
    }
  };

  _getCurrentAlbum() {
    // Prefer status metadata uri, then fall back to current playlist track.
    const meta = Model.status.metadata || {};
    const uri = meta['@_uri'];
    if (uri && Model.hasLibrary) {
      const fromStatus = Model.library.getAlbumByTrackUri(uri);
      if (fromStatus) {
        return fromStatus;
      }
    }

    // If stopped, but playlist exists, use first playlist item
    if (Model.status.isStopped && Model.playlist.array.length > 0 && Model.hasLibrary) {
      const first = Model.playlist.array[0];
      const firstUri = first['@_uri'];
      if (firstUri) {
        return Model.library.getAlbumByTrackUri(firstUri) || null;
      }
    }

    const currentIndex = Model.playlist?.currentIndex;
    const hasCurrentTrack = Number.isInteger(currentIndex)
      && currentIndex >= 0
      && currentIndex < (Model.playlist?.array?.length || 0);
    if (!hasCurrentTrack) {
      return null;
    }

    const currentTrack = Model.playlist.array[currentIndex];
    if (currentTrack?.album) {
      return currentTrack.album;
    }

    const trackUri = currentTrack?.['@_uri'];
    if (trackUri && Model.hasLibrary) {
      return Model.library.getAlbumByTrackUri(trackUri) || null;
    }

    return null;
  }

  _updateCoverArt() {
    const album = this._getCurrentAlbum();
    if (!album) {
      if (this._coverUrl) {
        this._coverUrl = '';
        this.$coverImg.attr('src', '');
      }
      return;
    }
    const url = DataUtil.getAlbumImageUrl(album);
    if (url && url !== this._coverUrl) {
      this._coverUrl = url;
      this.$coverImg.attr('src', url);
    }
  }

  onCoverClick = (e) => {
    const album = this._getCurrentAlbum();
    if (!album) {
      return;
    }
    $(document).trigger('library-item-click', album);
  };

  _updateVolumeInline() {
    const vol = Model.status.volume;
    if (isNaN(vol)) {
      return;
    }
    // Map roughly -40..+40 dB into 0..1
    let ratio = (vol + 40) / 80;
    ratio = Math.max(0, Math.min(1, ratio));
    const isVertical = window.matchMedia('(max-width: 1024px)').matches;
    if (isVertical) {
      this.$volumeInlineThumb.css('height', (ratio * 100) + '%');
      this.$volumeInlineThumb.css('width', '100%');
    } else {
      this.$volumeInlineThumb.css('width', (ratio * 100) + '%');
      this.$volumeInlineThumb.css('height', '100%');
    }
    this.$volumeInlineText.text(`${vol} dB`);
  }

  startVolumeDrag = (e) => {
    this.isVolumeDragging = true;
    if (this.$volumeInlineThumb && this.$volumeInlineThumb.length) this.$volumeInlineThumb.addClass('isDragging');
    $(window).on("mousemove touchmove", this.onVolumeDrag);
    $(window).on("mouseup touchend touchcancel", this.endVolumeDrag);
    const ratio = this._eventToVolumeRatio(e);
    if (!isNaN(ratio)) {
      this._setVolumeThumbRatio(ratio);
    }
    // temporarily disable click handler to avoid click after drag
    this.$volumeInlineTrack.off('click tap');
    setTimeout(() => this.$volumeInlineTrack.on('click tap', this.onVolumeTrackClick), 500);
  }

  onVolumeDrag = (e) => {
    const ratio = this._eventToVolumeRatio(e);
    if (isNaN(ratio)) return;
    this._setVolumeThumbRatio(ratio);
  }

  endVolumeDrag = (e) => {
    this.isVolumeDragging = false;
    if (this.$volumeInlineThumb && this.$volumeInlineThumb.length) this.$volumeInlineThumb.removeClass('isDragging');
    $(window).off("mouseup touchend touchcancel");
    $(window).off("mousemove touchmove");

    const ratio = this._eventToVolumeRatio(e) || 0;
    // compute target dB and send commands (same mapping as onVolumeTrackClick)
    const current = Model.status.volume;
    if (isNaN(current)) return;
    const target = Math.round((ratio * 80) - 40);
    const delta = target - current;
    if (delta === 0) return;
    const step = delta > 0 ? 1 : -1;
    const steps = Math.min(6, Math.abs(Math.round(delta)));
    const command = step > 0 ? Commands.volumeUp() : Commands.volumeDown();
    const commands = [];
    for (let i = 0; i < steps; i++) {
      commands.push(command);
    }
    commands.push(Commands.status());
    Service.queueCommandsFront(commands);
  }

  _eventToVolumeRatio(e) {
    const trackWidth = this.$volumeInlineTrack.width();
    const trackHeight = this.$volumeInlineTrack.height();
    if (!trackWidth || !trackHeight) return NaN;
    const offset = this.$volumeInlineTrack.offset();
    const touchPoint = (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0])
      ? e.originalEvent.touches[0]
      : null;
    const clientX = (e.clientX !== undefined) ? e.clientX : (touchPoint ? touchPoint.clientX : null);
    const clientY = (e.clientY !== undefined) ? e.clientY : (touchPoint ? touchPoint.clientY : null);
    const isVertical = window.matchMedia('(max-width: 1024px)').matches;

    let ratio;
    if (isVertical) {
      if (clientY === null) return NaN;
      ratio = (offset.top + trackHeight - clientY) / trackHeight;
    } else {
      if (clientX === null) return NaN;
      ratio = (clientX - offset.left) / trackWidth;
    }
    if (isNaN(ratio)) return NaN;
    return Math.max(0, Math.min(1, ratio));
  }

  _setVolumeThumbRatio(ratio) {
    const isVertical = window.matchMedia('(max-width: 1024px)').matches;
    if (isVertical) {
      this.$volumeInlineThumb.css('height', (ratio * 100) + '%');
      this.$volumeInlineThumb.css('width', '100%');
    } else {
      this.$volumeInlineThumb.css('width', (ratio * 100) + '%');
      this.$volumeInlineThumb.css('height', '100%');
    }
    const display = Math.round((ratio * 80) - 40);
    this.$volumeInlineText.text(`${display} dB`);
  }
}







