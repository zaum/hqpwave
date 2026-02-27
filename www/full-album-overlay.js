import Util from './util.js';
import ViewUtil from './view-util.js';

/**
 * Full-sized album image view.
 *
 * Slight-of-hand mechanics for transitioning album view image into a full-sized state.
 */
class FullAlbumOverlay {

  /** Overlay is above almost all other elements on the page */
  $overlayScreen = $('#fullOverlayScreen');
  /** The album image copy, which is actually one level above in the z-index. */
  $overlayImage = $('#fullOverlayImage');
  $sourceImage;

  constructor() {
    Util.addAppListener(this, 'album-picture-click', this.onAlbumPictureClick);
    this.$overlayScreen.on('click tap', () => this.animateOut());
    this.$overlayImage.on('click tap', () => this.animateOut());
  }

  noop() {}

  onAlbumPictureClick($sourceImage) {
    this.$sourceImage = $($sourceImage); // todo weird, revisit
    this.animateIn();
  }

  animateIn() {
    if (!this.$sourceImage || !this.$sourceImage.length) {
      return;
    }

    const src = this.$sourceImage.attr('src');
    if (!src) {
      return;
    }

    ViewUtil.setDisplayed(this.$overlayScreen, true);
    ViewUtil.setDisplayed(this.$overlayImage, true);
    ViewUtil.setVisible(this.$sourceImage, false);

    this.$overlayImage.attr('src', src);

    // Place abs pos overlay image on top of the in-flow album image, and animate
    const startRect = this.getConvertedStartRect(this.$sourceImage);
    const endRect = this.getEndRect(this.$sourceImage);
    if (!this.isValidRect(startRect) || !this.isValidRect(endRect)) {
      this.hide();
      return;
    }

    ViewUtil.animateCss(this.$overlayImage,
        () => ViewUtil.setLeftTopWidthHeight(this.$overlayImage, ...startRect),
        () => ViewUtil.setLeftTopWidthHeight(this.$overlayImage, ...endRect));

    // Also fade in overlay screen, which is right under overlay image
    ViewUtil.setCssSync(this.$overlayScreen, () => this.$overlayScreen.css('opacity', 0));
    this.$overlayScreen.css('opacity', 1);

    $(document).on('debounced-window-resize', this.onWindowResize);
  }

  animateOut() {
    if (!this.$sourceImage || !this.$sourceImage.length) {
      this.hide();
      return;
    }

    const r = this.getConvertedStartRect(this.$sourceImage);
    if (this.isValidRect(r)) {
      ViewUtil.setLeftTopWidthHeight(this.$overlayImage, ...r);
    }

    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      this.hide();
    };

    const fallbackTimeoutId = setTimeout(finish, 500);
    ViewUtil.animateCss(this.$overlayScreen,
        () => this.$overlayScreen.css('opacity', 1),
        () => this.$overlayScreen.css('opacity', 0),
        () => {
          clearTimeout(fallbackTimeoutId);
          finish();
        });
  }

  /**
   * Get source image's (real content) rect in overlay's coordinate space.
   * Overlay image will be placed on top for some swap action.
   */
  getConvertedStartRect($sourceImage) {
    const srcRect = $sourceImage[0].getBoundingClientRect();
    const overlayRect = this.$overlayScreen[0].getBoundingClientRect();
    let newX = srcRect.x - overlayRect.x;
    let newY = srcRect.y - overlayRect.y;
    let newW = srcRect.width;
    let newH = srcRect.height;

    // Source <img> is object-fit: contain, so need to shrink inside.
    const natchW = $sourceImage[0].naturalWidth;
    const natchH = $sourceImage[0].naturalHeight;
    if (!natchW || !natchH) {
      return [newX, newY, newW, newH];
    }
    const r = ViewUtil.fitInRect(natchW, natchH, newW, newH);
    newX += r.x;
    newW -= r.x * 2;
    newY += r.y;
    newH -= r.y * 2; // todo huh?
    return [newX, newY, newW, newH];
  }

  getEndRect($sourceImage) {
    if (!$sourceImage || !$sourceImage.length) {
      return [0, 0, 0, 0];
    }

    const naturalW = $sourceImage[0].naturalWidth;
    const naturalH = $sourceImage[0].naturalHeight;
    if (!naturalW || !naturalH) {
      return [0, 0, this.$overlayScreen.width(), this.$overlayScreen.height()];
    }

    const r = ViewUtil.fitInRect(
        naturalW, naturalH,
        this.$overlayScreen.width(), this.$overlayScreen.height());
    return [r.x, r.y, r.w, r.h];
  }

  isValidRect(rect) {
    return Array.isArray(rect)
      && rect.length === 4
      && rect.every(v => Number.isFinite(v));
  }

  hide() {
    ViewUtil.setDisplayed(this.$overlayScreen, false);
    ViewUtil.setDisplayed(this.$overlayImage, false);
    this.$sourceImage.css('visibility', ''); // nb! (?!)
    $(document).off('debounced-window-resize', this.onWindowResize);
  }

  onWindowResize = () => {
    const r = this.getEndRect(this.$sourceImage);
    ViewUtil.setCssSync(this.$overlayImage,
        () => ViewUtil.setLeftTopWidthHeight(this.$overlayImage, ...r));
  };
}

export default new FullAlbumOverlay();