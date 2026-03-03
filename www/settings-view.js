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

    // Setup scroll detection for Settings label
    this.$el.on('scroll', this.onSettingsScroll);

    // Setup color preset click handlers
    this.setupColorPresets();

    Util.addAppListener(this, 'model-info-updated', () => this.infoView.update());
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
    document.documentElement.style.setProperty('--accent', Settings.highlightColor);
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
