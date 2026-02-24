/**
 * Displays app info.
 */
import Model from './model.js';
import Statuser from './statuser.js';

export default class SettingsInfoView {

  $el;
  $hqpVersion;
  $hqpConnection;
  $connectionLed;

  constructor($el) {
    this.$el = $el;
    this.$hqpVersion = this.$el.find("#hqpVersion");
    this.$hqpConnection = this.$el.find("#hqpConnection");
    this.$connectionLed = this.$el.find("#connectionLed");
  }

  update() {
    const product = Model.infoData['@_product'];
    const platform = Model.infoData['@_platform'];
    const version = Model.infoData['@_version'];
    let s = '';
    if (product) {
      s = product;
    }
    if (platform) {
      s = s ? (s + ' / ' + platform) : '';
    }
    if (version) {
      const s2 = version ? ('<br>Version code: ' + version) : '';
      if (s2) {
        s = s ? (s + s2) : s;
      }
    }
    this.$hqpVersion.html(s);
    
    // Update connection LED
    this.updateConnectionStatus();
  }
  
  updateConnectionStatus() {
    const isConnected = Statuser.isConnected;
    if (this.$connectionLed) {
      if (isConnected) {
        this.$connectionLed.addClass('led-connected');
        this.$connectionLed.removeClass('led-disconnected');
      } else {
        this.$connectionLed.addClass('led-disconnected');
        this.$connectionLed.removeClass('led-connected');
      }
    }
    
    if (this.$hqpConnection) {
      if (isConnected) {
        this.$hqpConnection.text('Connected');
      } else {
        this.$hqpConnection.text('Disconnected');
      }
    }
  }
}
