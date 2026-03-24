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
import LibraryContentList from './library-content-list.js';


const splitAlbumArtists = (value) => {
  if (value === null || value === undefined) {
    return [];
  }

  const raw = String(value).trim();
  if (!raw) {
    return [];
  }

  const normalized = raw.replace(/\s+(feat\.?|featuring|ft\.?|with|vs\.? )\s+/gi, ';');
  const parts = normalized.split(/[,;/|&+]+/g);
  const result = [];
  const seen = new Set();

  for (const part of parts) {
    const artist = part.trim();
    if (!artist) {
      continue;
    }
    const key = artist.toLowerCase();
    // Ignore stray HTML-entity artefacts like 'amp' which can be produced
    // by earlier entity decoding and delimiter splitting.
    if (key === 'amp') {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(artist);
    if (result.length >= 20) {
      break;
    }
  }

  return result.length ? result : [raw];
};

// Escape string for regexp
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Normalize string: lower-case, remove diacritics, collapse spaces
const normalizeStr = (s) => {
  if (!s) return '';
  try {
    // remove diacritics
    const noDiacritics = s.normalize ? s.normalize('NFD').replace(/\p{Diacritic}/gu, '') : s;
    return String(noDiacritics).toLowerCase().replace(/\s+/g, ' ').trim();
  } catch (e) {
    return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  }
};


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
  trackMetaChangeHandler;

  album = null;
  tracks = null; // tracks array of album object

  currentPlayingSong = null;
  currentPlayingSongAlbumIndex = -1;
  albumImageUrls = [];
  albumImageIndex = 0;
  albumImageLoadSessionId = 0;
  albumCoverCount = 0;

  constructor() {
    super($("#albumView"));
    this.$pictureHolder = this.$el.find('.albumViewPictureOuter');
    this.$picture = this.$el.find('#albumViewPicture');
    this.$pictureBlur = this.$el.find('#albumViewPictureBlur');
    this.$albumFavoriteButton = this.$el.find('#albumFavoriteButton');
    this.$list = this.$el.find('#albumList');
    this.$artistButton = this.$el.find('#albumViewArtist');
    this.$texts = this.$el.find('#albumViewTexts');
    this.$relatedList = this.$el.find('#relatedAlbumsList');
    this.$relatedTitle = this.$el.find('.relatedAlbumsTitle');
    this.$prevImageButton = this.$el.find('#albumViewPrevImageButton');
    this.$nextImageButton = this.$el.find('#albumViewNextImageButton');

    this.trackMetaChangeHandler = TrackListItemUtil.makeTrackMetaChangeHandler(this.$list);

    this.$artistButton.on('click tap', '.albumArtistPart', this.onArtistButton);
    $("#albumPlayNowButton").on("click tap", this.onPlayNowButton);
    $("#albumQueueButton").on("click tap", this.onQueueButton);
    this.$albumFavoriteButton.on('click tap', this.onAlbumFavoriteButton);
    $("#albumCloseButton").on("click tap", () => $(document).trigger('album-view-close-button', this.album, true));
    this.$el.on("click", "#artistBackToLibraryButton", () => $(document).trigger('album-view-close-button', null, true));

    this.$picture.on('click tap', () => $(document).trigger('album-picture-click', {
      $sourceImage: this.$picture,
      album: this.album,
      coverCount: this.albumCoverCount
    }));
    this.$el.on('click tap', '#albumViewOpenFolderButton', this.onOpenFolderButtonClick);
    this.$prevImageButton.on('click tap', this.onPrevAlbumImageClick);
    this.$nextImageButton.on('click tap', this.onNextAlbumImageClick);

    this.$picturePlaceholder = null;
    this._isUnpinned = false;
    this.onRelatedAlbumFavoriteChanged = (e, hash, isFav) => {
      try {
        const selector = `[data-hash="${hash}"]`;
        const $item = this.$relatedList.find(selector);
        if ($item.length > 0) {
          if (isFav) {
            $item.addClass('isFavorite');
          } else {
            $item.removeClass('isFavorite');
          }
        }
      } catch (err) { /* ignore */ }
    };
    this.onAlbumViewScroll = () => {
      try {
        const st = this.$el[0].scrollTop || 0;
        const pictureTop = this.$pictureHolder.position() ? this.$pictureHolder.position().top : 0;
        const pictureHeight = this.$pictureHolder.outerHeight() || 0;
        // delay unpin a bit so it doesn't disappear prematurely
        const threshold = Math.max(0, pictureTop + pictureHeight + 40);

        // compute whether the tracklist bottom is visible within container
        const containerRect = this.$el[0].getBoundingClientRect();
        const listRect = this.$list[0].getBoundingClientRect();
        const listBottomVisible = (listRect.bottom <= containerRect.bottom - 8);

        if (!this._isUnpinned && st > threshold) {
          // create placeholder once to avoid layout jump
          const h = this.$pictureHolder.outerHeight();
          this.$picturePlaceholder = $('<div class="albumViewPicturePlaceholder" />').css({ height: h + 'px' });
          this.$pictureHolder.after(this.$picturePlaceholder);
          this.$pictureHolder.addClass('is-unpinned');
          this._isUnpinned = true;
        }

        if (this._isUnpinned) {
          // If user scrolled back up enough that the tracklist bottom is visible, restore
          if (listBottomVisible) {
            if (this.$picturePlaceholder) {
              this.$picturePlaceholder.remove();
              this.$picturePlaceholder = null;
            }
            this.$pictureHolder.removeClass('is-unpinned');
            this.$pictureHolder.css('transform', '');
            this._isUnpinned = false;
            return;
          }

          // Move picture up progressively; cap movement to picture height + small extra
          const dy = Math.min(pictureHeight + 24, st - threshold);
          this.$pictureHolder.css('transform', `translateY(${-Math.max(0, dy)}px)`);
        }
      } catch (e) {
        // ignore
      }
    };
  }

  show(album, $libraryItem = null) {
    this.currentPlayingSongAlbumIndex = -1;

    // Reset any stale visibility state (e.g. left over from full-overlay animation)
    this.$picture.css({ visibility: '', transform: '' });

    super.show();

    // nb, list items get generated on every show
    // Populate after show so layout/rects are valid (display:none breaks measurements).
    this.populate(album);
    this.$el[0].scrollTop = 0;

    // Populate related albums and attach scroll handler + favorite sync
    this.updateRelatedAlbums();
    $(document).on('album-favorite-changed.related', this.onRelatedAlbumFavoriteChanged);
    this.$el.off('scroll.albumView').on('scroll.albumView', this.onAlbumViewScroll);
    this._lastScrollTop = this.$el[0].scrollTop || 0;

    $(document).on('model-status-updated', this.updateHighlightedTrack);
    $(document).on('new-track', this.onNewTrack);
    $(document).on('meta-track-favorite-changed meta-track-incremented', this.trackMetaChangeHandler);

    // Content is revealed by the ViewTransition overlay fade-out.
    // Don't start a separate 520ms CSS opacity animation on texts/list —
    // it would still be mid-fade when the overlay disappears, causing a flash.
    this.$texts.css('opacity', 1);
    this.$list.css('opacity', 1);
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
      this.albumCoverCount = 0;
      this.updateAlbumImageNavButtons();
    });

    $(document).trigger('enable-user-input');
    this.$el.off('scroll.albumView');
    $(document).off('album-favorite-changed.related', this.onRelatedAlbumFavoriteChanged);
    // remove placeholder if present
    if (this.$picturePlaceholder) {
      this.$picturePlaceholder.remove();
      this.$picturePlaceholder = null;
    }
    this._isUnpinned = false;
    // reset any transform
    this.$pictureHolder.css('transform', '');
  };

  populate(album) {
    this.album = album;

    this.listItems$ = [];
    this.$list.empty();

    if (!this.album) {
      this.tracks = [];
      return;
    }

    this.tracks = AlbumUtil.getTracksOf(this.album);

    this.updateInfoArea();

    for (let i = 0; i < this.tracks.length; i++) { // todo fault
      const item = this.tracks[i];
      const $item = $(this.makeListItem(i, item));
      $item.on("click tap", e => this.onItemClick(e));
      $item.find(".queueTrackButton").on("click tap", e => this.onQueueTrackButtonClick(e));
      $item.find(".favoriteButton").on("click tap", e => TrackListItemUtil.onFavoriteButtonClick(e));
      $item.find(".playButton").on("click tap", e => this.onPlayButtonClick(e));
      this.listItems$.push($item);
      this.$list.append($item);
    }

    this.currentPlayingSong = undefined;
    this.updateHighlightedTrack();
  }

  updateInfoArea() {

    const defaultImageUrl = DataUtil.getAlbumImageUrl(this.album);
    this.albumCoverCount = defaultImageUrl ? 1 : 0;
    this.setAlbumImageByIndex(0, [defaultImageUrl]);

    const albumPath = AlbumUtil.decodeAlbumPath(this.album?.['@_path'] || '');
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

        this.albumCoverCount = uniqueRealImages.length || (defaultImageUrl ? 1 : 0);

        if (uniqueRealImages.length > 0) {
          const orderedImages = [defaultImageUrl];
          for (const imageUrl of uniqueRealImages) {
            if (imageUrl !== defaultImageUrl) {
              orderedImages.push(imageUrl);
            }
          }
          this.setAlbumImageByIndex(0, orderedImages);
        }
        this.updateAlbumImageNavButtons();
      });
    }

    this.renderAlbumArtists(this.album['@_artist'] || '');

    let s = this.album['@_album'] || '';
    s = s.trim();
    s = s || 'Album';
    $("#albumViewTitle").html(s);

    const $performer = $('#albumViewPerformer');
    const performer = this.album['@_performer'];
    if (performer) {
      $performer.empty();
      $performer.append($('<span class="metaCaption">Performed by </span>'));
      $performer.append($('<span class="metaValue"></span>').html(Util.formatMetaHtml(this.album['@_performer'])));
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
      $composer.empty();
      $composer.append($('<span class="metaCaption">Composed by </span>'));
      $composer.append($('<span class="metaValue"></span>').html(Util.formatMetaHtml(this.album['@_composer'])));
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

    const albumHash = this.getAlbumHash();
    MetaUtil.isAlbumFavoriteFor(albumHash)
      ? this.$albumFavoriteButton.addClass('isSelected')
      : this.$albumFavoriteButton.removeClass('isSelected')
  }

  updateRelatedAlbums() {
    try {
      if (!this.$relatedList || !this.album) {
        return;
      }
      this.$relatedList.empty();

      const artists = splitAlbumArtists(this.album['@_artist'] || this.album['@_performer'] || '');
      if (!artists.length) return;

      const allAlbums = (Model && Model.library && Array.isArray(Model.library.albums)) ? Model.library.albums : [];
      const currentHash = this.getAlbumHash();
      const matches = [];

      for (const a of allAlbums) {
        const h = a['@_hash'];
        if (!h || h === currentHash) continue;
        const aArtist = (a['@_artist'] || a['@_performer'] || '');
        const aArtistNorm = normalizeStr(aArtist);
        for (const art of artists) {
          if (!art) continue;
          const artNorm = normalizeStr(art);
          // whole-word match (avoid matching substrings like 'ada' -> 'adams')
          const pattern = new RegExp('\\b' + escapeRegExp(artNorm) + '\\b', 'i');
          if (pattern.test(aArtistNorm)) {
            matches.push(a);
            break;
          }
        }
      }

      if (!matches.length) {
        // hide related albums block when empty
        this.$relatedTitle && this.$relatedTitle.text('');
        ViewUtil.setDisplayed(this.$el.find('#relatedAlbums'), false);
        return;
      }

      // Show related albums block and set title to '<Artist> Other Albums'
      ViewUtil.setDisplayed(this.$el.find('#relatedAlbums'), true);
      const titleText = 'Related albums';
      if (this.$relatedTitle && this.$relatedTitle.length) {
        this.$relatedTitle.text(titleText);
      }

      // Render all matches
      const max = matches.length;
      for (let i = 0; i < max; i++) {
        const alb = matches[i];
        const $item = LibraryContentList.makeAlbumListItem(alb);
        // Ensure images are loaded immediately for this small list
        const $img = $item.find('img');
        if ($img.length) {
          const src = $img.attr('data-src') || $img.attr('src');
          if (src) {
            $img.attr('src', src);
          }
        }
        // Wire clicks/keyboard to open album view (use App to ensure scrolling)
        $item.on('click tap', (e) => {
          e.stopPropagation();
          if (App && App.instance && typeof App.instance.showAlbumView === 'function') {
            App.instance.showAlbumView(alb, $item);
            // ensure album view scrolls to top once shown
            setTimeout(() => {
              try {
                const av = App.instance.albumView;
                if (av && av.$el && av.$el[0]) {
                  av.$el[0].scrollTop = 0;
                }
              } catch (err) { /* ignore */ }
            }, 40);
          } else {
            $(document).trigger('library-item-click', [alb, $item]);
          }
        });
        $item.on('keydown', (e) => {
          if (e.keyCode == 13) {
            if (App && App.instance && typeof App.instance.showAlbumView === 'function') {
              App.instance.showAlbumView(alb, $item);
            } else {
              $(document).trigger('library-item-click', [alb, $item]);
            }
          }
        });


        this.$relatedList.append($item);
      }
    } catch (e) {
      cl('error updating related albums', e);
    }
  }

  getAlbumHash() {
    return this.album?.['@_hash'] || this.album?.['hash'] || '';
  }

  renderAlbumArtists(artistValue) {
    this.$artistButton.empty();

    const artists = splitAlbumArtists(artistValue);
    if (!artists.length) {
      this.$artistButton.text('Artist');
      return;
    }

    for (const artist of artists) {
      const $artistPart = $('<button type="button" class="albumArtistPart"></button>');
      $artistPart.text(artist);
      $artistPart.attr('data-artist', artist);
      this.$artistButton.append($artistPart);
    }
  }

  onArtistButton = (e) => {
    try {
      const $btn = $(e.currentTarget);
      const artist = $btn.attr('data-artist') || $btn.text();
      if (!artist) return;
      // Trigger app-level event to show artist view with artist name
      $(document).trigger('show-artist', artist);
    } catch (err) {
      // ignore
    }
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
      extra += `<div class='extraLine'><span class='caption'>Performer</span> <span class='extraValue'>${Util.formatMetaHtml(item['@_performer'])}</span></div>`;
    }
    if (item['@_artist']) { // song's artist (not album's artist)
      extra += `<div class='extraLine'><span class='caption'>Artist</span> <span class='extraValue'>${item['@_artist']}</span></div>`;
    }
    if (item['@_composer']) {
      extra += `<div class='extraLine'><span class='caption'>Composer</span> <span class='extraValue'>${Util.formatMetaHtml(item['@_composer'])}</span></div>`;
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
    s += `  <button type="button" class="iconButton albumItemQueueButton queueTrackButton" data-index="${index}" title="Add Track To Queue" aria-label="Add Track To Queue"><div class="iconPlus" aria-hidden="true"></div></button>`;
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

  onArtistButton = (event) => {
    const $button = $(event.currentTarget);
    let s = ($button.attr('data-artist') || '').trim();
    if (!s) {
      const artists = splitAlbumArtists(this.album?.['@_artist'] || '');
      s = (artists[0] || '').trim();
    }
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

  onPlayButtonClick(event) {
    event.stopPropagation();
    const $button = $(event.currentTarget);
    const index = parseInt($button.attr("data-index"));
    const startIndex = index;
    const endIndex = (this.tracks && this.tracks.length > 0)
      ? this.tracks.length - 1
      : startIndex;
    const isPlayNow = true;
    const commands = Commands.playlistAddUsingAlbumAndIndices(this.album, startIndex, endIndex, isPlayNow);
    AppUtil.doPlaylistAdds(commands, isPlayNow, isPlayNow);
  }

  onQueueTrackButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const $button = $(event.currentTarget).closest('.queueTrackButton');
    const $row = $button.closest('.albumItem');
    const index = parseInt($row.attr('data-index'));
    if (!(index >= 0)) {
      return;
    }
    const startIndex = index;
    const endIndex = index;
    const commands = Commands.playlistAddUsingAlbumAndIndices(this.album, startIndex, endIndex);
    AppUtil.doPlaylistAdds(commands, false, false);
  }

  onOpenFolderButtonClick = (event) => {
    event.stopPropagation();
    if (Util.isTouch) {
      return;
    }
    const path = AlbumUtil.decodeAlbumPath(this.album?.['@_path'] || '');
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
    const hasMultipleImages = this.albumCoverCount > 1;
    const canGoPrev = hasMultipleImages && this.albumImageIndex > 0;
    const canGoNext = hasMultipleImages && this.albumImageIndex < this.albumImageUrls.length - 1;
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
