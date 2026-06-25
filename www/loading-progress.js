export default class LoadingProgress {
  constructor() {
    this._size = 100;
    this._stroke = 4;
    this._radius = (this._size - this._stroke) / 2 - 3;
    this._circumference = 2 * Math.PI * this._radius;
    this._create();
  }

  _create() {
    this.$el = $(`
      <div id="loadingProgress" class="loading-overlay">
        <div class="loading-overlay-inner">
          <svg class="loading-overlay-ring" width="${this._size}" height="${this._size}" viewBox="0 0 ${this._size} ${this._size}">
            <circle cx="${this._size / 2}" cy="${this._size / 2}" r="${this._radius}" class="loading-ring-bg" fill="none"/>
            <circle cx="${this._size / 2}" cy="${this._size / 2}" r="${this._radius}" class="loading-ring-fg" fill="none" stroke-linecap="round"
              transform="rotate(-90 ${this._size / 2} ${this._size / 2})"
              style="stroke-dasharray:${this._circumference};stroke-dashoffset:${this._circumference}"/>
          </svg>
          <div class="loading-overlay-pct">0%</div>
        </div>
        <div class="loading-overlay-label">Connecting…</div>
      </div>
    `);
    this._$fg = this.$el.find('.loading-ring-fg');
    this._$pct = this.$el.find('.loading-overlay-pct');
    this._$label = this.$el.find('.loading-overlay-label');
    $('body').append(this.$el);
  }

  setProgress(pct, label) {
    const ratio = Math.max(0, Math.min(1, pct / 100));
    const offset = this._circumference * (1 - ratio);
    this._$fg.css('stroke-dashoffset', offset);
    this._$pct.text(Math.round(pct) + '%');
    if (label !== undefined) this._$label.text(label);
  }

  destroy() {
    if (this.$el) {
      this.$el.remove();
      this.$el = null;
    }
  }
}
