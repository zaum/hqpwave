// CircularProgress.js
// Simple SVG circular progress bar for use around play button

export default class CircularProgress {
  constructor($container, options = {}) {
    this.$container = $container;
    this.size = options.size || 48;
    this.stroke = options.stroke || 4;
    this.radius = (this.size - this.stroke) / 2;
    this.circumference = 2 * Math.PI * this.radius;
    this.$svg = null;
    this.$circle = null;
    this.init();
  }

  init() {
    this.$svg = $(
      `<svg width="${this.size}" height="${this.size}" viewBox="0 0 ${this.size} ${this.size}" style="position:absolute;left:0;top:0;pointer-events:none;">
        <circle cx="${this.size/2}" cy="${this.size/2}" r="${this.radius}" stroke="var(--accent)" stroke-width="${this.stroke}" fill="none" stroke-linecap="round"/>
      </svg>`
    );
    this.$circle = this.$svg.find('circle');
    this.$circle.css({
      'stroke-dasharray': this.circumference,
      'stroke-dashoffset': this.circumference
    });
    this.$container.append(this.$svg);
  }

  setProgress(ratio) {
    const offset = this.circumference * (1 - ratio);
    this.$circle.css('stroke-dashoffset', offset);
  }

  destroy() {
    if (this.$svg) this.$svg.remove();
  }
}
