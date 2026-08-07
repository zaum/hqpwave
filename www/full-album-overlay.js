import Util from './util.js';
import Native from './native.js';
import ViewUtil from './view-util.js';

const decodeAlbumPath = (value) => {
  let result = (typeof value === 'string') ? value : '';
  try {
    result = decodeURIComponent(result);
  } catch (e) {
    // keep raw if not URI-encoded
  }
  const entityMap = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'"
  };
  result = result.replace(/&(amp|lt|gt|quot|apos);/g, (m, name) => entityMap[name] || m);
  return result;
};

/**
 * Full-sized album image view.
 *
 * Slight-of-hand mechanics for transitioning album view image into a full-sized state.
 */
class FullAlbumOverlay {

  constructor() {
    this.$overlayScreen = $('#fullOverlayScreen');
    this.$overlayImage = $('#fullOverlayImage');
    this.$prevButton = $('#fullOverlayPrevButton');
    this.$nextButton = $('#fullOverlayNextButton');
    this.imageUrls = [];
    this.currentImageIndex = 0;
    this.albumCoverCountHint = 0;
    this.overlaySessionId = 0;
    this.isZoomAnimating = false;

    this.onPrevButtonClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.stepImage(-1);
    };
    this.onNextButtonClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.stepImage(1);
    };
    this.onDocumentKeydown = (event) => {
      if (!ViewUtil.isDisplayed(this.$overlayScreen)) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        this.stepImage(-1);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        this.stepImage(1);
        return;
      }
    };
    this.onOverlayImageLoad = () => {
      if (!this.$overlayImage.is(':visible')) {
        return;
      }
      if (this.isZoomAnimating) {
        return;
      }
      const r = this.getEndRect(this.$overlayImage);
      ViewUtil.setCssSync(this.$overlayImage,
        () => ViewUtil.setLeftTopWidthHeight(this.$overlayImage, ...r));
      this.updateNavRailsPosition(r);
    };
    this.onWindowResize = () => {
      const r = this.getEndRect(this.$overlayImage);
      ViewUtil.setCssSync(this.$overlayImage,
          () => ViewUtil.setLeftTopWidthHeight(this.$overlayImage, ...r));
      this.updateNavRailsPosition(r);
    };

    Util.addAppListener(this, 'album-picture-click', this.onAlbumPictureClick);
    this.$overlayScreen.on('click tap', () => this.animateOut());
    this.$overlayImage.on('click tap', () => this.animateOut());
    this.$overlayImage.on('load', this.onOverlayImageLoad);
    this.$prevButton.on('pointerdown mousedown touchstart', (event) => {
      event.stopPropagation();
    });
    this.$nextButton.on('pointerdown mousedown touchstart', (event) => {
      event.stopPropagation();
    });
    this.$prevButton.on('click tap', this.onPrevButtonClick);
    this.$nextButton.on('click tap', this.onNextButtonClick);
  }

  noop() {}

  onAlbumPictureClick(payload) {
    const $sourceImage = payload && payload.$sourceImage ? $(payload.$sourceImage) : $(payload);
    this.$sourceImage = $sourceImage; // todo weird, revisit
    this.albumCoverCountHint = Number.isFinite(payload && payload.coverCount) ? payload.coverCount : 0;
    const albumPath = decodeAlbumPath(payload && payload.album ? (payload.album['@_path'] || '') : '');
    const sourceUrl = this.$sourceImage.attr('src');
    this.overlaySessionId += 1;

    if (payload && payload.images && Array.isArray(payload.images)) {
      this.imageUrls = payload.images.map(img => typeof img === 'string' ? img : img.proxyUrl || img.url);
      this.currentImageIndex = Number.isInteger(payload.currentIndex) ? payload.currentIndex : 0;
      this.updateNavButtons();
    } else {
      this.loadGalleryImages(sourceUrl, albumPath, this.overlaySessionId);
    }
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

    this.isZoomAnimating = true;
    const clearZoomAnimatingTimeoutId = setTimeout(() => {
      this.isZoomAnimating = false;
    }, 900);

    ViewUtil.animateCss(this.$overlayImage,
        () => ViewUtil.setLeftTopWidthHeight(this.$overlayImage, ...startRect),
        () => ViewUtil.setLeftTopWidthHeight(this.$overlayImage, ...endRect),
        () => {
          clearTimeout(clearZoomAnimatingTimeoutId);
          this.isZoomAnimating = false;
        });
    this.updateNavRailsPosition(endRect);

    // Also fade in overlay screen, which is right under overlay image
    ViewUtil.setCssSync(this.$overlayScreen, () => this.$overlayScreen.css('opacity', 0));
    this.$overlayScreen.css('opacity', 1);

    $(document).on('debounced-window-resize', this.onWindowResize);
    $(document).on('keydown', this.onDocumentKeydown);
    this.updateNavButtons();
  }

  animateOut() {
    if (!this.$sourceImage || !this.$sourceImage.length) {
      this.hide();
      return;
    }

    const r = this.getConvertedStartRect(this.$sourceImage);
    this.isZoomAnimating = true;
    if (this.isValidRect(r)) {
      ViewUtil.setLeftTopWidthHeight(this.$overlayImage, ...r);
    }

    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      this.isZoomAnimating = false;
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

  loadGalleryImages(sourceUrl, albumPath, sessionId) {
    this.imageUrls = [];
    this.currentImageIndex = 0;

    const seen = new Set();
    if (sourceUrl) {
      seen.add(sourceUrl);
      this.imageUrls.push(sourceUrl);
    }
    this.updateNavButtons();

    if (!albumPath) {
      return;
    }

    Native.getAlbumImages(albumPath, (result) => {
      if (sessionId !== this.overlaySessionId) {
        return;
      }
      if (!result || !Array.isArray(result.images)) {
        this.updateNavButtons();
        return;
      }

      const uniqueRealImages = [];
      for (const imageUrl of result.images) {
        if (!imageUrl || seen.has(imageUrl)) {
          continue;
        }
        seen.add(imageUrl);
        uniqueRealImages.push(imageUrl);
      }

      if (uniqueRealImages.length > 0) {
        this.imageUrls = sourceUrl ? [sourceUrl, ...uniqueRealImages] : uniqueRealImages;
        this.currentImageIndex = 0;
      }
      this.updateNavButtons();
    });
  }

  stepImage(delta) {
    if (!this.imageUrls.length) {
      return;
    }
    const targetIndex = this.currentImageIndex + delta;
    if (targetIndex < 0 || targetIndex >= this.imageUrls.length) {
      this.updateNavButtons();
      return;
    }

    this.currentImageIndex = targetIndex;
    this.$overlayImage.attr('src', this.imageUrls[this.currentImageIndex]);
    this.updateNavButtons();
  }

  updateNavButtons() {
    const hasMultipleImages = this.albumCoverCountHint > 0
      ? this.albumCoverCountHint > 1
      : this.imageUrls.length > 1;
    const canGoPrev = hasMultipleImages && this.currentImageIndex > 0;
    const canGoNext = hasMultipleImages && this.currentImageIndex < this.imageUrls.length - 1;

    if (ViewUtil.isDisplayed(this.$overlayScreen)) {
      ViewUtil.setDisplayed(this.$prevButton, canGoPrev);
      ViewUtil.setDisplayed(this.$nextButton, canGoNext);
    } else {
      ViewUtil.setDisplayed(this.$prevButton, false);
      ViewUtil.setDisplayed(this.$nextButton, false);
    }

    this.$prevButton.toggleClass('isDisabled', !canGoPrev);
    this.$nextButton.toggleClass('isDisabled', !canGoNext);
    this.updateNavRailsPosition();
  }

  updateNavRailsPosition(rect = null) {
    if (!ViewUtil.isDisplayed(this.$overlayScreen)) {
      return;
    }
    const height = this.$overlayScreen.height() || window.innerHeight || 0;
    const style = {
      top: '0px',
      height: `${Math.max(0, height)}px`
    };
    this.$prevButton.css(style);
    this.$nextButton.css(style);
  }

  hide() {
    this.isZoomAnimating = false;
    ViewUtil.setDisplayed(this.$overlayScreen, false);
    ViewUtil.setDisplayed(this.$overlayImage, false);
    ViewUtil.setDisplayed(this.$prevButton, false);
    ViewUtil.setDisplayed(this.$nextButton, false);
    if (this.$sourceImage && this.$sourceImage.length) {
      this.$sourceImage.css('visibility', ''); // nb! (?!)
    }
    $(document).off('debounced-window-resize', this.onWindowResize);
    $(document).off('keydown', this.onDocumentKeydown);
    this.$prevButton.css({ top: '', height: '' });
    this.$nextButton.css({ top: '', height: '' });
    this.imageUrls = [];
    this.currentImageIndex = 0;
    this.updateNavButtons();
  }
}

export default new FullAlbumOverlay();