import AlbumContextMenu from './album-context-menu.js';
import AlbumUtil from './album-util.js'
import App from './app.js';
import AppUtil from './app-util.js'
import Commands from './commands.js';
import DataUtil from './data-util.js';
import MetaUtil from './meta-util.js'
import Model from './model.js';
import Service from './service.js';
import Subview from './subview.js';
import TopBar from './top-bar.js';
import TopBarUtil from './top-bar-util.js';
import TrackListItemUtil from './track-list-item-util.js';
import ToastView from './toast-view.js';
import Util from './util.js';
import Values from './values.js';
import ViewUtil from './view-util.js'
import Native from './native.js';

/**
 * Album view containing a header and a list of track list items.
 * todo put top area in its own class
 */
export default class AlbumView extends Subview {

  $pictureHolder;
  $picture;
  $texts;
  $artistButton;
  $albumFavoriteButton;
  listItems$;
  contextMenu;
  trackMetaChangeHandler;

  album = null;
  tracks = null; // tracks array of album object

  currentPlayingSong = null;
  currentPlayingSongAlbumIndex = -1;
  albumImageUrls = [];
  albumImageIndex = 0;
  albumImageLoadSessionId = 0;

  constructor() {
    super($("#albumView"));
    this.$pictureHolder = this.$el.find('.albumViewPictureOuter');
    this.$picture = this.$el.find('#albumViewPicture');
    this.$pictureBlur = this.$el.find('#albumViewPictureBlur');
    this.$albumFavoriteButton = this.$el.find('#albumFavoriteButton');
    this.$list = this.$el.find('#albumList');
    this.$artistButton = this.$el.find('#albumViewArtist');
    this.$texts = this.$el.find('#albumViewTexts');
    this.$openFolderButton = this.$el.find('#albumViewOpenFolderButton');
    this.$prevImageButton = this.$el.find('#albumViewPrevImageButton');
    this.$nextImageButton = this.$el.find('#albumViewNextImageButton');

    this.contextMenu = new AlbumContextMenu($("#albumContextMenu"));
    this.trackMetaChangeHandler = TrackListItemUtil.makeTrackMetaChangeHandler(this.$list);

    this.$artistButton.on('click tap', this.onArtistButton);
    $("#albumPlayNowButton").on("click tap", this.onPlayNowButton);
    $("#albumQueueButton").on("click tap", this.onQueueButton);
    this.$albumFavoriteButton.on('click tap', this.onAlbumFavoriteButton);
    $("#albumCloseButton").on("click tap", () => $(document).trigger('album-view-close-button', this.album, true));
    this.$picture.on('click tap', () => $(document).trigger('album-picture-click', {
      $sourceImage: this.$picture,
      album: this.album
    }));
    this.$openFolderButton.on('click tap', this.onOpenFolderButtonClick);
    this.$prevImageButton.on('click tap', this.onPrevAlbumImageClick);
    this.$nextImageButton.on('click tap', this.onNextAlbumImageClick);
  }

  show(album, $libraryItem = null) {
    this.currentPlayingSongAlbumIndex = -1;

    // Reset any stale visibility state (e.g. left over from full-overlay animation)
    this.$picture.css({ visibility: '', transform: '' });

    // nb, list items get generated on every show
    this.populate(album);
    this.$el[0].scrollTop = 0;

    super.show();

    $(document).on('model-status-updated', this.updateHighlightedTrack);
    $(document).on('new-track', this.onNewTrack);
    $(document).on('meta-track-favorite-changed meta-track-incremented', this.trackMetaChangeHandler);

    this.fadeInContent();
    this.onShowComplete();
  }

  onShowComplete = () => {
    $(document).trigger('enable-user-input');
  };

  fadeInContent() {
    ViewUtil.setCssSync(this.$texts, () => this.$texts.css('opacity', 0));
    ViewUtil.setCssSync(this.$list, () => this.$list.css('opacity', 0));
    ViewUtil.animateCss(this.$texts,
      null,
      () => this.$texts.css('opacity', 1));
    ViewUtil.animateCss(this.$list,
      null,
      () => this.$list.css('opacity', 1));
  }

hide() {
    this.contextMenu.hide();
    $(document).off('model-status-updated', this.updateHighlightedTrack);
    $(document).off('new-track', this.onNewTrack);
    $(document).off('meta-track-favorite-changed meta-track-incremented', this.trackMetaChangeHandler);

    // Do normal fadeout of album view
    super.hide(() => {
      // Prevent next show from displaying old image on any fail or delay
      this.$picture.attr('src', '');
      this.$pictureBlur.attr('src', '');
      // Reset any stale CSS state
      this.$picture.css({ transform: '', visibility: '' });
      this.albumImageUrls = [];
      this.albumImageIndex = 0;
      this.updateAlbumImageNavButtons();
    });

    $(document).trigger('enable-user-input');
  };

  populate(album) {
    this.album = album;
    this.tracks = AlbumUtil.getTracksOf(this.album);

    this.listItems$ = [];
    this.$list.empty();

    if (!this.album) {
      return;
    }

    this.updateInfoArea();

    for (let i = 0; i < this.tracks.length; i++) { // todo fault
      const item = this.tracks[i];
      const $item = $(this.makeListItem(i, item));
      $item.on("click tap", e => this.onItemClick(e));
      $item.find(".moreButton").on("click tap", e => this.onItemContextButtonClick(e));
      $item.find(".favoriteButton").on("click tap", e => TrackListItemUtil.onFavoriteButtonClick(e));
      $item.find(".playButton").on("click tap", e => this.onPlayButtonClick(e));
      this.listItems$.push($item);
      this.$list.append($item);
    }

    this.currentPlayingSong = undefined;
    this.updateHighlightedTrack();
  }

  updateInfoArea() {

    const imgPath = DataUtil.getAlbumImageUrl(this.album);
    this.setAlbumImageByIndex(0, [imgPath]);

    const albumPath = this.album?.['@_path'] || '';
    this.albumImageLoadSessionId += 1;
    const sessionId = this.albumImageLoadSessionId;
    if (albumPath) {
      Native.getAlbumImages(albumPath, (result) => {
        if (sessionId !== this.albumImageLoadSessionId) {
          return;
        }
        if (!result || !Array.isArray(result.images)) {
          this.updateAlbumImageNavButtons();
          return;
        }

        const uniqueRealImages = [];
        const seen = new Set();
        for (const imageUrl of result.images) {
          if (!imageUrl || seen.has(imageUrl)) {
            continue;
          }
          seen.add(imageUrl);
          uniqueRealImages.push(imageUrl);
        }

        if (uniqueRealImages.length > 0) {
          this.albumImageUrls = uniqueRealImages;
          this.albumImageIndex = 0;
          const current = this.albumImageUrls[this.albumImageIndex];
          this.$picture.attr('src', current);
          this.$pictureBlur.attr('src', current);
        }
        this.updateAlbumImageNavButtons();
      });
    }

    let s = this.album['@_artist'] || '';
    s = s.trim();
    s = s || 'Artist';
    this.$artistButton.html(s);

    s = this.album['@_album'] || '';
    s = s.trim();
    s = s || 'Album';
    $("#albumViewTitle").html(s);

    const $performer = $('#albumViewPerformer');
    const performer = this.album['@_performer'];
    if (performer) {
      s = `Performed by ${this.album['@_performer']}`;
      $performer.text(s);
      ViewUtil.setDisplayed($performer, true);
      if ($performer[0].scrollHeight > $performer[0].clientHeight) {
        $performer.addClass('pseudoEllipse');
      } else {
        $performer.removeClass('pseudoEllipse');
      }
    } else {
      $performer.text('');
      ViewUtil.setDisplayed($performer, false);
    }

    const $composer = $('#albumViewComposer');
    const composer = this.album['@_composer'];
    if (composer) {
      s = `Composed by ${this.album['@_composer']}`;
      $composer.text(s);
      ViewUtil.setDisplayed($composer, true);
      if ($composer[0].scrollHeight > $composer[0].clientHeight) {
        $composer.addClass('pseudoEllipse');
      } else {
        $composer.removeClass('pseudoEllipse');
      }
    } else {
      $composer.text('');
      ViewUtil.setDisplayed($composer, false);
    }
    ViewUtil.setDisplayed($('#albumViewPerformerComposer'), (performer || composer));

    $("#albumViewStats").html(AlbumUtil.makeAlbumStatsText(this.album));

    AlbumUtil.updateGenreButtons($('#albumViewGenreButtons'), this.album);

    const rawPath = this.album['@_path'] || '';
    $("#albumViewPath").text(rawPath);
    const isDesktopLike = !Util.isTouch;
    ViewUtil.setDisplayed(this.$openFolderButton, isDesktopLike && !!rawPath);

    const albumHash = this.getAlbumHash();
    MetaUtil.isAlbumFavoriteFor(albumHash)
      ? this.$albumFavoriteButton.addClass('isSelected')
      : this.$albumFavoriteButton.removeClass('isSelected')
  }

  getAlbumHash() {
    return this.album?.['@_hash'] || this.album?.['hash'] || '';
  }

  makeListItem(index, item) {
    const seconds = parseInt(item['@_length']);
    const durationText = seconds ? Util.durationText(seconds) : '';
    const durationEmptyClass = durationText ? '' : 'isEmpty';
    const song = item['@_song'];
    const hash = item['@_hash'];
    const isFavorite = MetaUtil.isTrackFavoriteFor(hash);
    const favoriteSelectedClass = isFavorite ? 'isSelected' : '';
    const numViews = MetaUtil.getNumViewsFor(hash);

    let extra = '';
    if (item['@_performer']) {
      extra += `<div class='extraLine'><span class='caption'>Performer:</span> ${item['@_performer']}</div>`;
    }
    if (item['@_artist']) { // song's artist (not album's artist)
      extra += `<div class='extraLine'><span class='caption'>Artist:</span> ${item['@_artist']}</div>`;
    }
    if (item['@_composer']) {
      extra += `<div class='extraLine'><span class='caption'>Composer:</span> ${item['@_composer']}</div>`;
    }

    let s = '';
    s += `<div class="albumItem" data-index="${index}" data-hash="${hash}">`;
    s += `  <div class="albumItemLeft">`;
    s += `    <div class="playButton iconPlay" data-index="${index}" title="Play Track Now"></div>`;
    s += `    <span class="indexText">${index + 1}</span>`;
    s += `  </div>`;
    s += `  <div class="albumItemMain">`;
    s += `    <div class="song">${song}</div>`;
    if (extra) {
      s += `  <div class="extra">${extra}</div>`;
    }
    s += `  </div>`;
    s += `  <div class="albumItemDurationCol ${durationEmptyClass}"><span class="albumItemDuration">${durationText}</span></div>`;
    s += `  <div class="trackItemMeta">`;
    s += `    <div class="numViews">${numViews || ''}</div>`;
    s += `    <div class="iconButton toggleButton favoriteButton ${favoriteSelectedClass}">`;
    s += `      <div class="favoriteIcon"></div>`;
    s += `    </div>`;
    s += `  </div>`;
    s += `  <div class="albumItemContext iconButton moreButton" data-index="${index}"></div>`;
    s += `</div>`;
    return $(s);
    // also: [$]["name"] is filename; [$]["hash"];
  }

  updateHighlightedTrack = () => {
    if (!this.tracks) {
      return;
    }
    const meta = Model.status.metadata;
    const song = meta['@_song'] || '';
    if (song === this.currentPlayingSong) {
      return;
    }
    this.currentPlayingSong = song;

    const isInAlbum = DataUtil.doesAlbumContainPlayingSong(this.album);

    for (let i = 0; i < this.tracks.length; i++) {
      const track = this.tracks[i];
      let b;
      if (!isInAlbum) {
        b = false;
      } else {
        b = DataUtil.doesAlbumSongEqualPlayingSong(this.album, track);
      }
      const $listItem = this.listItems$[i];
      if (b) {
        $listItem.addClass('selected');
      } else {
        $listItem.removeClass('selected');
      }
    }
  };

  getLibraryItemImageRect() {
    const r1 = this.$libraryItemImage[0].getBoundingClientRect();
    const r2 = this.$el[0].getBoundingClientRect();

    // Translation-adjusted bounding box of library list item's album image.
    let imgX = r1.x - r2.x;
    let imgY = r1.y - r2.y;
    let imgW = r1.width;
    let imgH = r1.height;

    // Adjust for object-fit: cover
    const naturalW = this.$libraryItemImage[0].naturalWidth;
    const naturalH = this.$libraryItemImage[0].naturalHeight;
    const naturalAr = (naturalW & naturalH) ? naturalW / naturalH : 1;

    let overlayX, overlayY, overlayW, overlayH;
    if (naturalAr > imgW / imgH) {
      overlayW = imgW * (naturalAr);
      overlayH = imgH;
      overlayY = imgY;
      overlayX = imgX - (overlayW - imgW) / 2;
    } else {
      overlayH = imgH * (1 / naturalAr);
      overlayW = imgW;
      overlayX = imgX;
      overlayY = imgY - (overlayH - imgH) / 2;
    }
    return [overlayX, overlayY, overlayW, overlayH];
  }

  getAlbumViewImageRect() {

    const r1 = this.$picture[0].getBoundingClientRect(); // rem, for anim-in, album view must be in its end-state!
    const r2 = this.$el[0].getBoundingClientRect();

    // Translation-adjusted bounding box of album view's album image.
    let boxX = r1.x - r2.x;
    let boxY = r1.y - r2.y;
    let boxW = r1.width;
    let boxH = r1.height;

    // Adjust for object-fit: _contain_ this time
    const naturalW = this.$libraryItemImage[0].naturalWidth;
    const naturalH = this.$libraryItemImage[0].naturalHeight;
    const naturalAr = (naturalW && naturalH) ? naturalW / naturalH : 1;

    let overlayX, overlayY, overlayW, overlayH;
    if (naturalAr > boxW / boxH) {
      // cl('image content has wider aspect ratio')
      overlayW = boxW;
      overlayH = boxW * (1 / naturalAr);
    } else {
      // cl('image content has narrower aspect ratio')
      overlayH = boxH;
      overlayW = boxH * naturalAr;
    }
    overlayX = boxX + (boxW - overlayW) / 2;
    overlayY = boxY + (boxH - overlayH) / 2;

    return [overlayX, overlayY, overlayW, overlayH];
  }

  onArtistButton = () => {
    let s = this.album['@_artist'] || '';
    s = s.trim();
    if (!s) {
      return;
    }
    $(document).trigger('album-artist-button', s);
  };

  onPlayNowButton = (event) => {
    const commands = Commands.playlistAddUsingAlbumAndIndices(this.album);
    AppUtil.doPlaylistAdds(commands, true, true);
  };

  onQueueButton = (event) => {
    const commands = Commands.playlistAddUsingAlbumAndIndices(this.album);
    AppUtil.doPlaylistAdds(commands);
  };

  onAlbumFavoriteButton = (event) => {
    const hash = this.getAlbumHash();
    if (!hash) {
      ToastView.show('Album favorite failed: missing album hash');
      return;
    }
    const oldValue = MetaUtil.isAlbumFavoriteFor(hash);
    const newValue = !oldValue;
    // update button
    if (newValue) {
      this.$albumFavoriteButton.addClass('isSelected');
    } else {
      this.$albumFavoriteButton.removeClass('isSelected');
    }
    // update model
    MetaUtil.setAlbumFavoriteFor(hash, newValue);
  }

  onItemClick(event) {
    const index = $(event.currentTarget).attr("data-index");
    const item = this.tracks[index];
    // ...
  }

  onItemContextButtonClick(event) {
    event.stopPropagation(); // prevent listitem from responding to same event
    const $button = $(event.currentTarget);
    const index = parseInt($button.attr("data-index"));
    this.contextMenu.show(this.$el, $button, this.album, index);
  }

  onPlayButtonClick(event) {
    event.stopPropagation();
    const $button = $(event.currentTarget);
    const index = parseInt($button.attr("data-index"));
    const startIndex = index;
    const endIndex = index;
    const isPlayNow = true;
    const commands = Commands.playlistAddUsingAlbumAndIndices(this.album, startIndex, endIndex, isPlayNow);
    AppUtil.doPlaylistAdds(commands, isPlayNow, isPlayNow);
  }

  onOpenFolderButtonClick = (event) => {
    event.stopPropagation();
    if (Util.isTouch) {
      return;
    }
    const path = this.album?.['@_path'];
    if (!path) {
      return;
    }
    Native.openFolder(path, (result) => {
      if (!result || result.error) {
        ToastView.show('Could not open folder');
      }
    });
  }

  setAlbumImageByIndex(index, initialUrls = null) {
    if (Array.isArray(initialUrls)) {
      this.albumImageUrls = [...initialUrls];
    }

    if (!this.albumImageUrls.length) {
      this.albumImageIndex = 0;
      this.$picture.attr('src', '');
      this.$pictureBlur.attr('src', '');
      this.updateAlbumImageNavButtons();
      return;
    }

    const maxIndex = this.albumImageUrls.length - 1;
    const clampedIndex = Math.max(0, Math.min(index, maxIndex));
    this.albumImageIndex = clampedIndex;
    const url = this.albumImageUrls[this.albumImageIndex];
    this.$picture.attr('src', url);
    this.$pictureBlur.attr('src', url);
    this.updateAlbumImageNavButtons();
  }

  updateAlbumImageNavButtons() {
    const canGoPrev = this.albumImageUrls.length > 1 && this.albumImageIndex > 0;
    const canGoNext = this.albumImageUrls.length > 1 && this.albumImageIndex < this.albumImageUrls.length - 1;
    const hasMultipleImages = this.albumImageUrls.length > 1;
    ViewUtil.setDisplayed(this.$prevImageButton, hasMultipleImages);
    ViewUtil.setDisplayed(this.$nextImageButton, hasMultipleImages);
    this.$prevImageButton.toggleClass('isGhost', !canGoPrev);
    this.$nextImageButton.toggleClass('isGhost', !canGoNext);
  }

  onPrevAlbumImageClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    this.setAlbumImageByIndex(this.albumImageIndex - 1);
  }

  onNextAlbumImageClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    this.setAlbumImageByIndex(this.albumImageIndex + 1);
  }

  onNewTrack = (e, currentUri, lastUri) => {
    if (App.instance.getTopSubview() != this) {
      return;
    }
    const currentTrack = Model.library.getTrackByUri(currentUri);
    const currentAlbumIndex = this.tracks.indexOf(currentTrack);
    const lastTrack = Model.library.getTrackByUri(lastUri);
    const lastAlbumIndex = this.tracks.indexOf(lastTrack);
    if (currentAlbumIndex > -1) {
      if (currentAlbumIndex > lastAlbumIndex) {
        const $listItem = this.listItems$[currentAlbumIndex];
        Util.autoScrollListItem($listItem, this.$el);
      }
    }
  };

  /**
   * Given an abs el whose left/top/width/height are already set to `r1`,
   * set its transform such that its new apparent position and dimensions
   * are that of `r2`.
   *
   * @param $el
   * @param r1 an array with [x,y,w,h]
   * @param r2
   */
  setTransformUsing = ($el, r1, r2) => {
    const dx = r2[0] - r1[0];
    const dy = r2[1] - r1[1];
    const sx = r2[2] / r1[2];
    const sy = r2[3] / r1[3];
    const value = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    $el.css('transform', value);
  };

}
