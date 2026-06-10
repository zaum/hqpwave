import AppUtil from './app-util.js';
import Commands from './commands.js';
import MetaUtil from './meta-util.js';
import Model from './model.js';
import Service from './service.js';
import Settings from './settings.js';
import SettingsInfoView from './settings-info-view.js';
import Subview from './subview.js';
import ToastView from './toast-view.js';
import Util from './util.js';
import Values from './values.js';
import ViewUtil from './view-util.js';

/**
 * Setting view, with image init facility and general app info.
 */
export default class SettingsView extends Subview {

  $closeButton;
  $themeDarkCheckbox;
  $themeLightCheckbox;
  $showPlayButtonCheckbox;
  $showFormatOverlayCheckbox;
  $showLogoAnimationCheckbox;
  $artistReleaseLimitInput;
  $artistImageLimitInput;
  $artistBioLimitInput;
  $artistBatchImportButton;
  $artistBatchImportStatusText;
  $highlightColorPicker;
  $playerBackgroundColorPicker;
  $hideLabelsWithFewAlbumsCheckbox;
  $labelVisibilityThresholdInput;
  infoView;
  _artistBatchImportPollTimer = null;
  _artistBatchWasRunning = false;

  constructor() {
    super($("#settingsView"));
    this.$closeButton = this.$el.find('#settingsCloseButton');
    this.$themeDarkCheckbox = this.$el.find('#themeDark');
    this.$themeLightCheckbox = this.$el.find('#themeLight');
    this.$closeButton.on('click tap', (e) => $(document).trigger('settings-view-close'));
    this.infoView = new SettingsInfoView(this.$el.find("#settingsInfoView"));

    this.$themeDarkCheckbox.on('click tap', this.onThemeCheckbox);
    this.$themeLightCheckbox.on('click tap', this.onThemeCheckbox);
    this.$showPlayButtonCheckbox = this.$el.find('#settingsShowPlayButtonCheckbox');
    this.$showPlayButtonCheckbox.on('click tap', this.onShowPlayButtonCheckbox);
    this.$showFormatOverlayCheckbox = this.$el.find('#settingsShowFormatOverlayCheckbox');
    this.$showFormatOverlayCheckbox.on('click tap', this.onShowFormatOverlayCheckbox);
    this.$showLibraryDateAndFormatCheckbox = this.$el.find('#settingsShowLibraryDateAndFormatCheckbox');
    this.$showLibraryDateAndFormatCheckbox.on('click tap', this.onShowLibraryDateAndFormatCheckbox);
    this.$showLogoAnimationCheckbox = this.$el.find('#settingsShowLogoAnimationCheckbox');
    this.$showLogoAnimationCheckbox.on('click tap', this.onShowLogoAnimationCheckbox);
    this.$artistReleaseLimitInput = this.$el.find('#artistReleaseLimitInput');
    this.$artistReleaseLimitInput.on('change', this.onArtistReleaseLimitChange);
    this.$artistReleaseLimitInput.on('blur', this.onArtistReleaseLimitChange);
    this.$artistImageLimitInput = this.$el.find('#artistImageLimitInput');
    this.$artistImageLimitInput.on('change', this.onArtistImageLimitChange);
    this.$artistImageLimitInput.on('blur', this.onArtistImageLimitChange);
    this.$artistBioLimitInput = this.$el.find('#artistBioLimitInput');
    this.$artistBioLimitInput.on('change', this.onArtistBioLimitChange);
    this.$artistBioLimitInput.on('blur', this.onArtistBioLimitChange);
    this.$artistBatchImportButton = this.$el.find('#artistBatchImportButton');
    this.$artistBatchImportButton.on('click', () => this.onArtistBatchImportClick());
    this.$artistBatchImportStatusText = this.$el.find('#artistBatchImportStatusText');
    this.$highlightColorPicker = this.$el.find('#highlightColorPicker');
    this.$highlightColorPicker.on('change', this.onHighlightColorChange);
    this.$playerBackgroundColorPicker = this.$el.find('#playerBackgroundColorPicker');
    this.$playerBackgroundColorPicker.on('change', this.onPlayerBackgroundColorChange);
    this.$hideLabelsWithFewAlbumsCheckbox = this.$el.find('#settingsHideLabelsWithFewAlbums');
    this.$hideLabelsWithFewAlbumsCheckbox.on('click tap', this.onHideLabelsWithFewAlbumsCheckbox);
    this.$labelVisibilityThresholdInput = this.$el.find('#labelVisibilityThresholdInput');
    this.$labelVisibilityThresholdInput.on('change', this.onLabelVisibilityThresholdChange);
    this.$labelVisibilityThresholdInput.on('blur', this.onLabelVisibilityThresholdChange);
    this.$el.find('#metaDownload').attr('href', Values.META_DOWNLOAD_LINK);
    this.$el.find('#metaDelete').on('click', () => this.onMetaDeleteClick());

    this.$artistDbSize = this.$el.find('#artistDbSize');
    this.$clearArtistDbBtn = this.$el.find('#clearArtistDbBtn');
    this.$clearArtistDbBtn.on('click', () => this.clearArtistDb());
    this.$artistDbDownload = this.$el.find('#artistDbDownload');
    this.$artistDbDownload.on('click', (e) => {
      e.preventDefault();
      window.location.href = '/endpoints/artistDbDownload';
    });

    this.$imageScrapingEnabled = this.$el.find('#imageScrapingEnabled');
    this.$imageSourcesList = this.$el.find('#imageSourcesList');
    this.$newImageSourceUrl = this.$el.find('#newImageSourceUrl');
    this.$addImageSourceBtn = this.$el.find('#addImageSourceBtn');
    this.$addImageSourceBtn.on('click', () => this.addImageSource());
    this.$imageScrapingEnabled.on('change', () => this.saveImageSources());
    this.imageSources = [];

    // Setup scroll detection for Settings label
    this.$el.on('scroll', this.onSettingsScroll);

    // Setup color preset click handlers
    this.setupColorPresets();

    Util.addAppListener(this, 'model-info-updated', () => this.infoView.update());
  }

  loadArtistDbStats() {
    fetch('/endpoints/artistDbStats')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          const totalText = data.totalSizeFormatted || '0 B';
          this.$artistDbSize.text(totalText);
        } else {
          this.$artistDbSize.text('0 B');
        }
      })
      .catch(e => {
        this.$artistDbSize.text('0 B');
      });
  }

  clearArtistDb() {
    if (!confirm('Clear all cached artist data (database + images folder)? This cannot be undone.')) {
      return;
    }
    this.$clearArtistDbBtn.text('Clearing...').prop('disabled', true);
    fetch('/endpoints/artistDbClear', { method: 'POST' })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw (data || { error: 'server_error' });
        }
        return data;
      })
      .then(data => {
        if (data && data.success) {
          this.loadArtistDbStats();
          this.loadArtistBatchImportStatus();
        } else if (data && data.error) {
          alert('Error clearing data: ' + data.error);
        }
      })
      .catch(e => {
        console.error('Error clearing artist DB', e);
        alert('Error clearing data: ' + ((e && e.error) || 'server_error'));
      })
      .finally(() => {
        this.$clearArtistDbBtn.text('Clear').prop('disabled', false);
      });
  }

  loadImageSources() {
    fetch('/endpoints/imageSources')
      .then(res => {
        if (!res.ok) throw new Error('server_error');
        return res.json();
      })
      .then(data => {
        this.$imageScrapingEnabled.prop('checked', data.enabled !== false);
        this.imageSources = data.sources || [];
        this.renderImageSourcesList();
      })
      .catch(e => {
        this.imageSources = ['https://www.last.fm/music/{ARTIST}/+images/*'];
        this.renderImageSourcesList();
      });
  }

  renderImageSourcesList() {
    this.$imageSourcesList.empty();
    const self = this;
    
    for (let i = 0; i < this.imageSources.length; i++) {
      const source = this.imageSources[i];
      const isEnabled = source.endsWith('*');
      const displayUrl = isEnabled ? source.slice(0, -1) : source;
      
      const $item = $('<div class="image-source-item"></div>');
      const $indicator = $('<span class="source-enabled-indicator' + (isEnabled ? ' enabled' : '') + '"></span>');
      const $urlInput = $('<input type="text" class="source-url-input" value="' + displayUrl + '" title="' + source + '">');
      
      $urlInput.on('change', () => {
        let newUrl = $urlInput.val().trim();
        if (!newUrl) return;
        
        if (!newUrl.endsWith('*') && !newUrl.endsWith('/')) {
          newUrl = newUrl + '*';
        } else if (newUrl.endsWith('/')) {
          newUrl = newUrl + '*';
        }
        
        self.imageSources[i] = newUrl;
        const newIsEnabled = newUrl.endsWith('*');
        $urlInput.val(newIsEnabled ? newUrl.slice(0, -1) : newUrl);
        $indicator.toggleClass('enabled', newIsEnabled);
        self.saveImageSources();
      });
      
      $urlInput.on('focus', () => {
        $urlInput.select();
      });
      
      const $deleteBtn = $('<button class="delete-source-btn deleteButton" title="Remove source"></button>');
      
      $deleteBtn.on('click', () => {
        this.imageSources.splice(i, 1);
        this.renderImageSourcesList();
        this.saveImageSources();
      });
      
      $item.append($indicator, $urlInput, $deleteBtn);
      this.$imageSourcesList.append($item);
    }
  }

  addImageSource() {
    const url = this.$newImageSourceUrl.val().trim();
    if (!url) return;
    
    let finalUrl = url;
    if (!url.endsWith('*') && !url.endsWith('/')) {
      finalUrl = url + '/*';
    } else if (url.endsWith('/')) {
      finalUrl = url + '*';
    }
    
    if (!this.imageSources.includes(finalUrl)) {
      this.imageSources.push(finalUrl);
      this.renderImageSourcesList();
      this.saveImageSources();
    }
    this.$newImageSourceUrl.val('');
  }

  saveImageSources() {
    const enabled = this.$imageScrapingEnabled.prop('checked');
    
    fetch('/endpoints/imageSources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, sources: this.imageSources })
    })
    .then(res => {
      if (!res.ok) throw new Error('server_error');
      return res.json();
    })
    .then(data => {
      console.log('Image sources saved');
    })
    .catch(e => {
      console.error('Error saving image sources', e);
    });
  }

  setupColorPresets() {
    // Accent color presets
    $('#highlightColorPresets').on('click', '.color-preset:not(.custom)', (e) => {
      const color = $(e.currentTarget).data('color');
      Settings.highlightColor = color;
      this.updateHighlightColorCSS();
      $('#highlightColorPicker').val(color);
    });

    // Player background color presets
    $('#playerBackgroundColorPresets').on('click', '.color-preset:not(.custom)', (e) => {
      const color = $(e.currentTarget).data('color');
      Settings.playerBackgroundColor = color;
      this.updatePlayerBackgroundColorCSS();
      $('#playerBackgroundColorPicker').val(color);
    });
  }

  show() {
    super.show();

    const $version = this.$el.find('#settingsVersion');
    $version.text(`v${Values.hqpwvVersion}`);
    const $anchor = this.$el.find("#settingsProjectAnchor");
    $anchor.text(Values.PROJECT_URL);
    $anchor.attr('href', Values.PROJECT_URL);

    this.updateThemeCheckbox();

    this.updateShowPlayButtonCheckbox();

    this.updateShowFormatOverlayCheckbox();

    this.updateShowLibraryDateAndFormatCheckbox();

    this.updateShowLogoAnimationCheckbox();

    this.updateArtistReleaseLimitInput();
    this.updateArtistImageLimitInput();
    this.updateArtistBioLimitInput();

    this.updateHighlightColorPicker();

    this.updatePlayerBackgroundColorPicker();

    this.updateHideLabelsWithFewAlbumsCheckbox();
    this.updateLabelVisibilityThresholdInput();

    this.$el[0].scrollTop = 0;

    Service.queueCommandFront(Commands.getInfo());

    this.loadArtistDbStats();
    this.loadImageSources();
    this.loadArtistBatchImportStatus();
    this.startArtistBatchImportPolling();

    $(document).trigger('enable-user-input');
  }

  hide() {
    super.hide();
    this.stopArtistBatchImportPolling();
    $(document).trigger('enable-user-input');
  }

  updateThemeCheckbox() {
    if (Settings.colorTheme == 'dark') {
      this.$themeLightCheckbox.removeClass('active');
      this.$themeDarkCheckbox.addClass('active');
    } else {
      this.$themeDarkCheckbox.removeClass('active');
      this.$themeLightCheckbox.addClass('active');
    }
  }

  updateHighlightColorPicker() {
    this.$highlightColorPicker.val(Settings.highlightColor);
    this.updateHighlightColorCSS();
  }

  updatePlayerBackgroundColorPicker() {
    this.$playerBackgroundColorPicker.val(Settings.playerBackgroundColor);
    this.updatePlayerBackgroundColorCSS();
  }

  updateHighlightColorCSS() {
    AppUtil.updateAccentColorCSS(Settings.highlightColor);
  }

  onHighlightColorChange = () => {
    Settings.highlightColor = this.$highlightColorPicker.val();
    this.updateHighlightColorCSS();
  };

  onPlayerBackgroundColorChange = () => {
    Settings.playerBackgroundColor = this.$playerBackgroundColorPicker.val();
    this.updatePlayerBackgroundColorCSS();
  };

  updatePlayerBackgroundColorCSS() {
    document.documentElement.style.setProperty('--player-bg-color', Settings.playerBackgroundColor);
    document.documentElement.style.setProperty('--player-bg', Settings.playerBackgroundColor);
    // Also update playbar background
    const playbar = document.getElementById('playbarView');
    if (playbar) {
      playbar.style.background = Settings.playerBackgroundColor;
    }
  }

  onSettingsScroll = () => {
    const scrollTop = this.$el[0].scrollTop;
    const settingsLabel = this.$el.find('#settingsScrollLabel');
    if (scrollTop > 50) {
      settingsLabel.addClass('visible');
    } else {
      settingsLabel.removeClass('visible');
    }
  };

  onThemeCheckbox = (e) => {
    Settings.colorTheme = (e.currentTarget.id == 'themeDark') ? 'dark' : 'light';
    this.updateThemeCheckbox();
    // And update the theme
    AppUtil.updateColorTheme();
  };

  updateShowPlayButtonCheckbox() {
    if (Settings.showPlayButton) {
      this.$showPlayButtonCheckbox.addClass('isChecked');
      this.$showPlayButtonCheckbox.prop('checked', true);
    } else {
      this.$showPlayButtonCheckbox.removeClass('isChecked');
      this.$showPlayButtonCheckbox.prop('checked', false);
    }
  }

  onShowPlayButtonCheckbox = () => {
    Settings.showPlayButton = !Settings.showPlayButton;
    this.updateShowPlayButtonCheckbox();
  }

  updateShowFormatOverlayCheckbox() {
    if (Settings.showFormatOverlay) {
      this.$showFormatOverlayCheckbox.addClass('isChecked');
      this.$showFormatOverlayCheckbox.prop('checked', true);
    } else {
      this.$showFormatOverlayCheckbox.removeClass('isChecked');
      this.$showFormatOverlayCheckbox.prop('checked', false);
    }
  }

  onShowFormatOverlayCheckbox = () => {
    Settings.showFormatOverlay = !Settings.showFormatOverlay;
    this.updateShowFormatOverlayCheckbox();
  }

  updateShowLibraryDateAndFormatCheckbox() {
    if (Settings.showLibraryDateAndFormat) {
      this.$showLibraryDateAndFormatCheckbox.addClass('isChecked');
      this.$showLibraryDateAndFormatCheckbox.prop('checked', true);
    } else {
      this.$showLibraryDateAndFormatCheckbox.removeClass('isChecked');
      this.$showLibraryDateAndFormatCheckbox.prop('checked', false);
    }
  }

  onShowLibraryDateAndFormatCheckbox = () => {
    Settings.showLibraryDateAndFormat = !Settings.showLibraryDateAndFormat;
    this.updateShowLibraryDateAndFormatCheckbox();
  }

  updateShowLogoAnimationCheckbox() {
    if (Settings.showLogoAnimation) {
      this.$showLogoAnimationCheckbox.addClass('isChecked');
      this.$showLogoAnimationCheckbox.prop('checked', true);
    } else {
      this.$showLogoAnimationCheckbox.removeClass('isChecked');
      this.$showLogoAnimationCheckbox.prop('checked', false);
    }
  }

  onShowLogoAnimationCheckbox = () => {
    Settings.showLogoAnimation = !Settings.showLogoAnimation;
    this.updateShowLogoAnimationCheckbox();
  }

  updateHideLabelsWithFewAlbumsCheckbox() {
    if (Settings.hideLabelsWithFewAlbums) {
      this.$hideLabelsWithFewAlbumsCheckbox.addClass('isChecked');
      this.$hideLabelsWithFewAlbumsCheckbox.prop('checked', true);
    } else {
      this.$hideLabelsWithFewAlbumsCheckbox.removeClass('isChecked');
      this.$hideLabelsWithFewAlbumsCheckbox.prop('checked', false);
    }
  }

  onHideLabelsWithFewAlbumsCheckbox = () => {
    Settings.hideLabelsWithFewAlbums = !Settings.hideLabelsWithFewAlbums;
    this.updateHideLabelsWithFewAlbumsCheckbox();
  }

  updateLabelVisibilityThresholdInput() {
    this.$labelVisibilityThresholdInput.val(String(Settings.labelVisibilityThreshold));
  }

  onLabelVisibilityThresholdChange = () => {
    Settings.labelVisibilityThreshold = this.$labelVisibilityThresholdInput.val();
    this.updateLabelVisibilityThresholdInput();
  }

  updateArtistReleaseLimitInput() {
    this.$artistReleaseLimitInput.val(String(Settings.artistReleaseLimit));
  }

  onArtistReleaseLimitChange = () => {
    Settings.artistReleaseLimit = this.$artistReleaseLimitInput.val();
    this.updateArtistReleaseLimitInput();
  }

  updateArtistImageLimitInput() {
    this.$artistImageLimitInput.val(String(Settings.artistImageLimit));
  }

  onArtistImageLimitChange = () => {
    Settings.artistImageLimit = this.$artistImageLimitInput.val();
    this.updateArtistImageLimitInput();
  }

  updateArtistBioLimitInput() {
    this.$artistBioLimitInput.val(String(Settings.artistBioLimit));
  }

  onArtistBioLimitChange = () => {
    Settings.artistBioLimit = this.$artistBioLimitInput.val();
    this.updateArtistBioLimitInput();
  }

  getLibraryArtistNames() {
    const albums = (Model.library && Array.isArray(Model.library.albums)) ? Model.library.albums : [];
    const artistNames = [];
    const seen = new Set();

    for (const album of albums) {
      const rawArtist = String((album && (album['@_artist'] || album['@_performer'])) || '').replace(/\s+/g, ' ').trim();
      if (!rawArtist) continue;
      const key = rawArtist.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      artistNames.push(rawArtist);
    }

    return artistNames;
  }

  onMetaDeleteClick() {
    if (!confirm('Are you sure you want to delete all local metadata? This action cannot be undone.')) {
      return;
    }
    fetch('/endpoints/meta?clear', { method: 'POST' })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(() => ToastView.show('Metadata deleted. Refresh page.'))
      .catch(() => ToastView.show('Failed to delete metadata.'));
  }

  startArtistBatchImportPolling() {
    this.stopArtistBatchImportPolling();
    this._artistBatchImportPollTimer = window.setInterval(() => {
      this.loadArtistBatchImportStatus();
    }, 2000);
  }

  stopArtistBatchImportPolling() {
    if (this._artistBatchImportPollTimer) {
      window.clearInterval(this._artistBatchImportPollTimer);
      this._artistBatchImportPollTimer = null;
    }
  }

  startArtistBatchImport() {
    const artistNames = this.getLibraryArtistNames();
    if (artistNames.length === 0) {
      alert('No artists found in the library yet.');
      return;
    }

    this.$artistBatchImportButton.prop('disabled', true).text('Starting...');

    fetch('/endpoints/artistBatchImport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artistNames,
        releaseLimit: Settings.artistReleaseLimit,
        imageLimit: Settings.artistImageLimit
      })
    })
      .then(res => res.ok ? res.json() : res.json().then(data => Promise.reject(data)))
      .then(() => this.loadArtistBatchImportStatus())
      .catch(e => {
        const message = e && e.error ? e.error : 'Unable to start artist metadata download.';
        alert(message);
        this.$artistBatchImportButton.prop('disabled', false).text('Start');
      });
  }

  onArtistBatchImportClick() {
    const currentText = this.$artistBatchImportButton.text();
    if (currentText === 'Stop') {
      this.stopArtistBatchImport();
    } else {
      this.startArtistBatchImport();
    }
  }

  stopArtistBatchImport() {
    this.$artistBatchImportButton.prop('disabled', true).text('Stopping...');
    fetch('/endpoints/artistBatchImportStop', { method: 'POST' })
      .then(res => res.ok ? res.json() : null)
      .catch(() => {});
  }

  formatArtistBatchImportStatus(status) {
    if (!status || !status.status || status.status === 'idle') {
      return 'Idle.';
    }

    if (status.status === 'running') {
      const lines = [
        `${status.remaining || 0} artists remaining`,
        `Imported: ${status.imported || 0}`,
        `Skipped: ${status.skipped || 0}`,
        `Failed: ${status.failed || 0}`
      ];
      if (status.currentArtist) {
        lines.push(`Current: ${status.currentArtist}`);
      }
      return lines.join('<br>');
    }

    if (status.status === 'done') {
      if (!status.total) {
        return 'No artists found in the library.';
      }
      const lines = [
        `Imported: ${status.imported || 0}`,
        `Skipped: ${status.skipped || 0}`,
        `Failed: ${status.failed || 0}`
      ];
      if (status.lastError) {
        lines.push(`Last error: ${status.lastError}`);
      }
      return lines.join('<br>');
    }

    if (status.status === 'stopped') {
      const lines = [
        `Processed: ${status.checked || 0}`,
        `Imported: ${status.imported || 0}`,
        `Skipped: ${status.skipped || 0}`,
        `Failed: ${status.failed || 0}`
      ];
      return lines.join('<br>');
    }

    return 'Idle.';
  }

  updateArtistBatchImportUi(status) {
    const isRunning = !!(status && status.status === 'running');
    const isStopped = !!(status && status.status === 'stopped');
    this.$artistBatchImportStatusText.html(this.formatArtistBatchImportStatus(status));
    this.$artistBatchImportButton.prop('disabled', false);
    this.$artistBatchImportButton.text(isRunning ? 'Stop' : 'Start');

    const $settingsButton = $('#settingsButton');
    const $rowLabel = $('#artistBatchImportLabel');

    if (isRunning) {
      this._artistBatchWasRunning = true;
      this.loadArtistDbStats();
      $settingsButton.addClass('pulse');
      $rowLabel.addClass('pulse');
    } else if (isStopped) {
      this._artistBatchWasRunning = true;
      this.loadArtistDbStats();
      $settingsButton.removeClass('pulse');
      $rowLabel.removeClass('pulse');
    } else {
      $settingsButton.removeClass('pulse');
      $rowLabel.removeClass('pulse');
    }

    if (this._artistBatchWasRunning && !isRunning && !isStopped) {
      this._artistBatchWasRunning = false;
    }
  }

  loadArtistBatchImportStatus() {
    fetch('/endpoints/artistBatchImportStatus')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        this.updateArtistBatchImportUi(data ? data.status : null);
      })
      .catch(() => {
        this.updateArtistBatchImportUi(null);
      });
  }
}
