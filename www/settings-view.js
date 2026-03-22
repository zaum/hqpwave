import AppUtil from './app-util.js';
import Commands from './commands.js';
import MetaUtil from './meta-util.js';
import Model from './model.js';
import Service from './service.js';
import Settings from './settings.js';
import SettingsInfoView from './settings-info-view.js';
import Subview from './subview.js';
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
  $highlightColorPicker;
  $playerBackgroundColorPicker;
  infoView;

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
    this.$showLogoAnimationCheckbox = this.$el.find('#settingsShowLogoAnimationCheckbox');
    this.$showLogoAnimationCheckbox.on('click tap', this.onShowLogoAnimationCheckbox);
    this.$highlightColorPicker = this.$el.find('#highlightColorPicker');
    this.$highlightColorPicker.on('change', this.onHighlightColorChange);
    this.$playerBackgroundColorPicker = this.$el.find('#playerBackgroundColorPicker');
    this.$playerBackgroundColorPicker.on('change', this.onPlayerBackgroundColorChange);
    this.$el.find('#metaDownload').attr('href', Values.META_DOWNLOAD_LINK);

    this.$artistDbSize = this.$el.find('#artistDbSize');
    this.$clearArtistDbBtn = this.$el.find('#clearArtistDbBtn');
    this.$clearArtistDbBtn.on('click', () => this.clearArtistDb());

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
          const sizeText = data.dbSizeFormatted || '0 B';
          const imgText = data.imageCount > 0 ? `, ${data.imageCount} images` : '';
          this.$artistDbSize.text(`${sizeText}${imgText}`);
        } else {
          this.$artistDbSize.text('0 B');
        }
      })
      .catch(e => {
        this.$artistDbSize.text('0 B');
      });
  }

  clearArtistDb() {
    if (!confirm('Clear all cached artist metadata (covers, bios, images)? This cannot be undone.')) {
      return;
    }
    this.$clearArtistDbBtn.text('Clearing...').prop('disabled', true);
    fetch('/endpoints/artistDbClear', { method: 'POST' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.success) {
          this.$artistDbSize.text('0 B');
        }
      })
      .catch(e => console.error('Error clearing artist DB', e))
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
      
      const $deleteBtn = $('<button class="delete-source-btn" title="Remove source"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"></path></svg></button>');
      
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

    this.updateShowLogoAnimationCheckbox();

    this.updateHighlightColorPicker();

    this.updatePlayerBackgroundColorPicker();

    this.$el[0].scrollTop = 0;

    Service.queueCommandFront(Commands.getInfo());

    this.loadArtistDbStats();
    this.loadImageSources();

    $(document).trigger('enable-user-input');
  }

  hide() {
    super.hide();
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
}
