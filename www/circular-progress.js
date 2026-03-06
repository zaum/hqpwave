// CircularProgress.js
// Simple SVG circular progress bar for use around play button

export default class CircularProgress {
  constructor($container, options = {}) {
    this.$container = $container;
    this.size = options.size || 56;
    this.stroke = (options.stroke || 4) - 1; // 1 px-el kisebb
    this.radius = (this.size - this.stroke - 8) / 2; // 4px spacing on each side
    this.circumference = 2 * Math.PI * this.radius;
    this.$svg = null;
    this.$circle = null;
    this.init();
  }

  init() {
    this.$svg = $(
      `<svg class="circular-progress" width="${this.size}" height="${this.size}" viewBox="0 0 ${this.size} ${this.size}" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:1;">
        <circle cx="${this.size/2}" cy="${this.size/2}" r="${this.radius}" stroke="var(--surface2)" stroke-width="${this.stroke}" fill="none"/>
        <circle cx="${this.size/2}" cy="${this.size/2}" r="${this.radius}" stroke="var(--accent)" stroke-width="${this.stroke}" fill="none" stroke-linecap="round" transform="rotate(180 ${this.size/2} ${this.size/2})"/>
      </svg>`
    );
    this.$circle = this.$svg.find('circle').eq(1); // the second circle is the progress
    this.$circle.css({
      'stroke-dasharray': this.circumference,
      'stroke-dashoffset': this.circumference // initially empty, set by setProgress
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
