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
  $spotifyConnectionLed;
  $spotifyConnectionText;
  $testSpotifyBtn;
  $lastfmConnectionLed;
  $lastfmConnectionText;
  $testLastFmBtn;
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

    this.$spotifyClientId = this.$el.find('#spotifyClientId');
    this.$spotifyClientSecret = this.$el.find('#spotifyClientSecret');
    this.$saveSpotifyBtn = this.$el.find('#saveSpotifyBtn');
    this.$spotifyConnectionLed = this.$el.find('#spotifyConnectionLed');
    this.$spotifyConnectionText = this.$el.find('#spotifyConnectionText');
    this.$testSpotifyBtn = this.$el.find('#testSpotifyBtn');
    this.$saveSpotifyBtn.on('click', () => this.saveSpotifyCredentials());
    this.$testSpotifyBtn.on('click', () => this.testSpotifyConnection(true));

    this.$lastfmApiKey = this.$el.find('#lastfmApiKey');
    this.$saveLastFmBtn = this.$el.find('#saveLastFmBtn');
    this.$lastfmConnectionLed = this.$el.find('#lastfmConnectionLed');
    this.$lastfmConnectionText = this.$el.find('#lastfmConnectionText');
    this.$testLastFmBtn = this.$el.find('#testLastFmBtn');
    this.$saveLastFmBtn.on('click', () => this.saveLastFmCredentials());
    this.$testLastFmBtn.on('click', () => this.testLastFmConnection(true));

    this.$artistDbSize = this.$el.find('#artistDbSize');
    this.$clearArtistDbBtn = this.$el.find('#clearArtistDbBtn');
    this.$clearArtistDbBtn.on('click', () => this.clearArtistDb());

    // Setup scroll detection for Settings label
    this.$el.on('scroll', this.onSettingsScroll);

    // Setup color preset click handlers
    this.setupColorPresets();

    Util.addAppListener(this, 'model-info-updated', () => this.infoView.update());
  }

  loadSpotifyCredentials() {
    fetch('/endpoints/spotifyCredentials')
      .then(res => {
         if (!res.ok) throw new Error('server_error');
         return res.json();
      })
      .then(data => {
         this.$spotifyClientId.val(data.clientId || '');
         this.$spotifyClientSecret.val(data.clientSecret || '');
      })
       .catch(e => console.error('Error loading Spotify credentials', e));
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

  saveSpotifyCredentials() {
    const clientId = this.$spotifyClientId.val();
    const clientSecret = this.$spotifyClientSecret.val();
    this.$saveSpotifyBtn.text('Saving...').prop('disabled', true);
    fetch('/endpoints/spotifyCredentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret })
    })
    .then(res => {
       if (!res.ok) throw new Error('server_error');
       return res.json();
    })
    .then(data => {
       if (data.success) {
         this.$saveSpotifyBtn.text('Saved!');
         // Refresh connection test after saving credentials.
         this.testSpotifyConnection(false);
         setTimeout(() => {
           this.$saveSpotifyBtn.text('Save Spotify Credentials').prop('disabled', false);
         }, 2000);
       } else {
         throw new Error(data.error);
       }
    })
     .catch(e => {
        console.error('Error saving Spotify credentials', e);
        this.$saveSpotifyBtn.text('Error!');
        setTimeout(() => {
            this.$saveSpotifyBtn.text('Save Spotify Credentials').prop('disabled', false);
        }, 2000);
     });
  }

  loadLastFmCredentials() {
    fetch('/endpoints/lastfmCredentials')
      .then(res => {
         if (!res.ok) throw new Error('server_error');
         return res.json();
      })
      .then(data => {
        if (data && data.apiKey) {
          this.$lastfmApiKey.val(data.apiKey);
        }
      })
      .catch(e => console.error('Error loading Last.fm credentials', e));
  }

  saveLastFmCredentials() {
    const apiKey = this.$lastfmApiKey.val();
    this.$saveLastFmBtn.text('Saving...').prop('disabled', true);
    fetch('/endpoints/lastfmCredentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey })
    })
    .then(res => {
       if (!res.ok) throw new Error('server_error');
       return res.json();
    })
    .then(data => {
        if (data.success) {
          this.$saveLastFmBtn.text('Saved!');
          this.testLastFmConnection(false);
          setTimeout(() => {
            this.$saveLastFmBtn.text('Save Last.fm Credentials').prop('disabled', false);
          }, 2000);
        } else {
          throw new Error(data.error);
        }
     })
     .catch(e => {
        console.error('Error saving Last.fm credentials', e);
        this.$saveLastFmBtn.text('Error!');
        setTimeout(() => {
            this.$saveLastFmBtn.text('Save Last.fm Credentials').prop('disabled', false);
        }, 2000);
     });
  }

  testLastFmConnection(manualTriggered = false) {
    if (manualTriggered && this.$testLastFmBtn && this.$testLastFmBtn.length) {
      this.$testLastFmBtn.text('Testing...').prop('disabled', true);
    }
    if (this.$lastfmConnectionText && this.$lastfmConnectionText.length) {
      this.$lastfmConnectionText.text('Testing...');
    }
    this.$lastfmConnectionLed.removeClass('led-connected led-disconnected led-error').addClass('led-disconnected');
    fetch('/endpoints/lastfmCredentials')
      .then(res => {
         if (!res.ok) throw new Error('server_error');
         return res.json();
      })
      .then(data => {
         if (!data.apiKey || data.apiKey.trim() === '') {
           this.$lastfmConnectionText.text('Not configured');
           this.$lastfmConnectionLed.removeClass('led-connected led-error').addClass('led-disconnected');
           this.finishLastFmTest();
           return null;
         }
         // Test with a simple API call
         return fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=test&api_key=${encodeURIComponent(data.apiKey)}&format=json`)
           .then(r => r.json())
           .then(json => {
              if (json && json.error) {
                throw new Error(json.message || 'Invalid API key');
              }
              this.$lastfmConnectionText.text('Connected');
              this.$lastfmConnectionLed.removeClass('led-disconnected led-error').addClass('led-connected');
           });
      })
      .then(() => this.finishLastFmTest())
      .catch(e => {
         console.error('Error testing Last.fm connection', e);
         this.$lastfmConnectionText.text('Error');
         this.$lastfmConnectionLed.removeClass('led-connected led-disconnected').addClass('led-error');
         this.finishLastFmTest();
      });
  }

  finishLastFmTest() {
     if (this.$testLastFmBtn && this.$testLastFmBtn.length) {
       this.$testLastFmBtn.text('Test Last.fm Connection').prop('disabled', false);
     }
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

    this.loadSpotifyCredentials();
    this.loadLastFmCredentials();
    this.loadArtistDbStats();
    // Auto-test Spotify connectivity when Settings opens.
    this.testSpotifyConnection(false);
    this.testLastFmConnection(false);

    $(document).trigger('enable-user-input');
  }

  testSpotifyConnection(manualTriggered = false) {
    try {
      if (manualTriggered && this.$testSpotifyBtn && this.$testSpotifyBtn.length) {
        this.$testSpotifyBtn.text('Testing...').prop('disabled', true);
      }
      if (this.$spotifyConnectionText && this.$spotifyConnectionText.length) {
        this.$spotifyConnectionText.text('Testing...');
      }
      if (this.$spotifyConnectionLed && this.$spotifyConnectionLed.length) {
        this.$spotifyConnectionLed.removeClass('led-connected').addClass('led-disconnected');
      }

      fetch('/endpoints/testSpotifyConnection')
        .then(res => {
          if (!res.ok) throw new Error('server_error');
          return res.json();
        })
        .then(data => {
          const ok = !!data && data.success;
          if (ok) {
            if (this.$spotifyConnectionLed && this.$spotifyConnectionLed.length) {
              this.$spotifyConnectionLed.addClass('led-connected').removeClass('led-disconnected');
            }
            if (this.$spotifyConnectionText && this.$spotifyConnectionText.length) {
              this.$spotifyConnectionText.text(data.message || 'Connected');
            }
          } else {
            if (this.$spotifyConnectionLed && this.$spotifyConnectionLed.length) {
              this.$spotifyConnectionLed.addClass('led-disconnected').removeClass('led-connected');
            }
            if (this.$spotifyConnectionText && this.$spotifyConnectionText.length) {
              this.$spotifyConnectionText.text(data && data.error ? data.error : 'Disconnected');
            }
          }
        })
        .catch(() => {
          if (this.$spotifyConnectionLed && this.$spotifyConnectionLed.length) {
            this.$spotifyConnectionLed.addClass('led-disconnected').removeClass('led-connected');
          }
          if (this.$spotifyConnectionText && this.$spotifyConnectionText.length) {
            this.$spotifyConnectionText.text('Error');
          }
        })
        .finally(() => {
          if (manualTriggered && this.$testSpotifyBtn && this.$testSpotifyBtn.length) {
            this.$testSpotifyBtn.text('Test Spotify Connection').prop('disabled', false);
          }
        });
    } catch (e) {
      if (manualTriggered && this.$testSpotifyBtn && this.$testSpotifyBtn.length) {
        this.$testSpotifyBtn.text('Test Spotify Connection').prop('disabled', false);
      }
      if (this.$spotifyConnectionLed && this.$spotifyConnectionLed.length) {
        this.$spotifyConnectionLed.addClass('led-disconnected').removeClass('led-connected');
      }
      if (this.$spotifyConnectionText && this.$spotifyConnectionText.length) {
        this.$spotifyConnectionText.text('Error');
      }
      console.error('testSpotifyConnection failed', e);
    }
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
