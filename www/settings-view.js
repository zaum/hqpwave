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
  $metaCheckbox;
  $highlightColorPicker;
  $playerBackgroundColorPicker;
  infoView;

  constructor() {
    super($("#settingsView"));
    this.$closeButton = this.$el.find('#settingsCloseButton');
    this.$metaCheckbox = this.$el.find('#settingsMetaCheckbox');
    this.$themeDarkCheckbox = this.$el.find('#themeDark');
    this.$themeLightCheckbox = this.$el.find('#themeLight');
    this.$closeButton.on('click tap', (e) => $(document).trigger('settings-view-close'));
    this.infoView = new SettingsInfoView(this.$el.find("#settingsInfoView"));

    this.$themeDarkCheckbox.on('click tap', this.onThemeCheckbox);
    this.$themeLightCheckbox.on('click tap', this.onThemeCheckbox);
    this.$metaCheckbox.on('click tap', this.onMetaCheckbox);
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
    // Highlight color presets
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

    this.updateMetaCheckbox();

    this.updateHighlightColorPicker();

    this.updatePlayerBackgroundColorPicker();

    ViewUtil.doStockFadeIn(this.$el);
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

  updateMetaCheckbox() {
    if (Settings.isMetaEnabled) {
      this.$metaCheckbox.addClass('isChecked');
    } else {
      this.$metaCheckbox.removeClass('isChecked');
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
    document.documentElement.style.setProperty('--col-highlight', Settings.highlightColor);
    // Also update --accent for new design
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

  onMetaCheckbox = () => {
    Settings.isMetaEnabled = !Settings.isMetaEnabled;
    this.updateMetaCheckbox();
  }
}
