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

  optimisticTimerId = null;
  optimisticSeconds = -1;
  optimisticTotal = 0;

  playingText;
  systemMessageText;
  currentSecondsText;
  totalSecondsText;
  ratio;
  isVolumePanelShowing = false;
  _coverUrl = '';
  isTransportFadeRunning = false;
  transportFadeUnlockTimeoutId = null;
  transportFadeStepTimeoutId = null;

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
    this.$stopButton.on('click tap', this.onStopButton);
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
    Util.addAppListener(this, 'new-track', this.onNewTrackDetected);
    Util.addAppListener(this, 'playbar-track-change-command', this.onTrackChangeCommand);

    this.pointerUtil = new ModalPointerUtil(
        [this.$volumeInline, this.$volumeToggle, this.volumePanel.$el],
        () => {
          this.hideVolumePopup();
          this.hideVolumePanel();
        });
  }

  _initCircularProgress() {
    // Breakpoints: 480 / 768 / 1024 / 1600
    // Keep the circular progress visible up to 1024px. The horizontal progress
    // bar is hidden at <=1024px in CSS, so without this we'd have no progress UI
    // between 768–1024.
    const isMobile = window.innerWidth < 1024;
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
      const nowMobile = window.innerWidth < 1024;
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
    // Position relative to the element's offsetParent (the actual containing block
    // for absolutely-positioned elements). Using the DOM offsetParent ensures the
    // computed left matches the CSS positioning context (fixes placement on small
    // screens where the parent may be statically positioned).
    const el = this.$volumeInline[0];
    const container = el.offsetParent || document.documentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const toggleRect = this.$volumeToggle[0].getBoundingClientRect();
    const centerX = (toggleRect.left + (toggleRect.width / 2)) - containerRect.left;
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
    // stop any optimistic progress timer — real status has arrived
    if (this.optimisticTimerId) {
      clearInterval(this.optimisticTimerId);
      this.optimisticTimerId = null;
      this.optimisticSeconds = -1;
      this.optimisticTotal = 0;
    }
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

  onNewTrackDetected = (uri, lastUri) => {
    // Clear any previous optimistic timer
    if (this.optimisticTimerId) {
      clearInterval(this.optimisticTimerId);
      this.optimisticTimerId = null;
    }

    // Try to determine total seconds from status or playlist, fallback to 240s
    let total = Model.status.totalSeconds;
    if (!total || total <= 0) {
      const idx = Model.playlist.currentIndex;
      const item = (idx >= 0 && Model.playlist.array[idx]) ? Model.playlist.array[idx] : null;
      if (item) {
        const min = parseInt(item['@_total_min']);
        const sec = parseInt(item['@_total_sec']);
        if (!isNaN(min) && !isNaN(sec)) {
          total = (min * 60) + sec;
        }
      }
    }
    if (!total || total <= 0) total = 240;

    this.optimisticTotal = total;
    this.optimisticSeconds = 0;
    this.progressView.update(0, 0);

    // Increment optimistic progress each second until real status arrives
    this.optimisticTimerId = setInterval(() => {
      this.optimisticSeconds++;
      if (this.optimisticSeconds >= this.optimisticTotal) {
        clearInterval(this.optimisticTimerId);
        this.optimisticTimerId = null;
        return;
      }
      const ratio = this.optimisticSeconds / this.optimisticTotal;
      this.progressView.update(ratio, this.optimisticSeconds);
      try {
        // Update the current time text immediately (optimistic)
        this.$trackCurrentTime.text(Util.durationText(this.optimisticSeconds));
        // Update circular progress if present
        if (this.circularProgress && typeof ratio === 'number') {
          this.circularProgress.setProgress(ratio);
        }
        // Show total seconds if not yet populated
        if (!this.totalSecondsText || this.totalSecondsText === '--:--') {
          this.$trackLength.text(Util.durationText(this.optimisticTotal));
        }
      } catch (e) {
        // swallow any UI errors
      }
    }, 1000);
  }

  onPlayButton = (e) => {
    if (Model.status.isPlaying) {
      this.queueTransportWithFade(Commands.pause());
      return;
    }

    Service.queueCommandFrontAndGetStatus(Commands.play());
  };

  onStopButton = () => {
    this.queueTransportWithFade(Commands.stop());
  };

  onPreviousButton = (e) => {
    this.queueTransportWithFade(Commands.previous());
  };

  onNextButton = (e) => {
    this.queueTransportWithFade(Commands.next());
  };

  onTrackChangeCommand = (commandXml) => {
    this.queueTransportWithFade(commandXml);
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
    // Breakpoints: 480 / 768 / 1024 / 1600. CSS switches to horizontal at >=1024.
    const isVertical = window.innerWidth < 1024;

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

  queueTransportWithFade(transportCommand) {
    if (this.isTransportFadeRunning) {
      return;
    }

    if (!Model.status.isPlaying) {
      Service.queueCommandFrontAndGetStatus(transportCommand);
      return;
    }

    const currentVolume = Model.status.volume;
    const fadeTargets = this.buildTransportFadeTargets(currentVolume);
    if (fadeTargets.length === 0) {
      Service.queueCommandFrontAndGetStatus(transportCommand);
      return;
    }

    this.beginTransportFadeLock();
    this.runTransportFadeStep({
      transportCommand: transportCommand,
      originalVolume: currentVolume,
      fadeTargets: fadeTargets,
      index: 0
    });
  }

  buildTransportFadeTargets(currentVolume) {
    if (isNaN(currentVolume)) {
      return [];
    }

    const minVolume = -40;
    const fadeDepth = Math.min(18, Math.max(0, currentVolume - minVolume));
    if (fadeDepth <= 0) {
      return [];
    }

    const targetVolume = currentVolume - fadeDepth;
    const steps = Math.min(4, fadeDepth);
    const targets = [];

    for (let i = 1; i <= steps; i++) {
      const rawTarget = currentVolume - ((fadeDepth * i) / steps);
      const nextValue = Math.max(minVolume, Math.round(rawTarget));
      if (nextValue < currentVolume && nextValue !== targets[targets.length - 1]) {
        targets.push(nextValue);
      }
    }

    if (targets.length === 0 && targetVolume < currentVolume) {
      targets.push(targetVolume);
    }

    return targets;
  }

  runTransportFadeStep({ transportCommand, originalVolume, fadeTargets, index }) {
    if (index >= fadeTargets.length) {
      this.finishTransportFade(transportCommand, originalVolume);
      return;
    }

    const nextVolume = fadeTargets[index];
    Service.queueCommandFront(Commands.volume(nextVolume), () => {
      clearTimeout(this.transportFadeStepTimeoutId);
      this.transportFadeStepTimeoutId = setTimeout(() => {
        this.runTransportFadeStep({
          transportCommand: transportCommand,
          originalVolume: originalVolume,
          fadeTargets: fadeTargets,
          index: index + 1
        });
      }, 55);
    });
  }

  finishTransportFade(transportCommand, originalVolume) {
    Service.queueCommandFront(transportCommand, () => {
      clearTimeout(this.transportFadeStepTimeoutId);
      this.transportFadeStepTimeoutId = setTimeout(() => {
        this.restoreTransportVolume(originalVolume);
      }, 120);
    });
  }

  restoreTransportVolume(originalVolume) {
    if (isNaN(originalVolume)) {
      Service.queueCommandFront(Commands.status(), () => {
        this.endTransportFadeLock();
      });
      return;
    }

    Service.queueCommandFront(Commands.volume(originalVolume), () => {
      Service.queueCommandFront(Commands.status(), () => {
        this.endTransportFadeLock();
      });
    });
  }

  beginTransportFadeLock() {
    clearTimeout(this.transportFadeUnlockTimeoutId);
    clearTimeout(this.transportFadeStepTimeoutId);
    this.isTransportFadeRunning = true;
    this.transportFadeUnlockTimeoutId = setTimeout(() => {
      this.endTransportFadeLock();
    }, 2000);
  }

  endTransportFadeLock() {
    clearTimeout(this.transportFadeUnlockTimeoutId);
    clearTimeout(this.transportFadeStepTimeoutId);
    this.transportFadeUnlockTimeoutId = null;
    this.transportFadeStepTimeoutId = null;
    this.isTransportFadeRunning = false;
  }

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
      // Notify app that playbar cover changed so top-bar can update promptly
      try { $(document).trigger('playbar-cover-updated'); } catch (e) {}
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
    // Breakpoints: 480 / 768 / 1024 / 1600. CSS switches to horizontal at >=1024.
    const isVertical = window.innerWidth < 1024;
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
    // Breakpoints: 480 / 768 / 1024 / 1600. CSS switches to horizontal at >=1024.
    const isVertical = window.innerWidth < 1024;

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
    // Breakpoints: 480 / 768 / 1024 / 1600. CSS switches to horizontal at >=1024.
    const isVertical = window.innerWidth < 1024;
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







