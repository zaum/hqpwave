import Subview from './subview.js';
import Util from './util.js';
import Model from './model.js';
import ViewUtil from './view-util.js';
import DataUtil from './data-util.js';
import AlbumUtil from './album-util.js';
import AppUtil from './app-util.js';
import Commands from './commands.js';
import Settings from './settings.js';
import Values from './values.js';

export default class ArtistView extends Subview {

  constructor() {
    const $el = $('#artistView');
    super($el);
    this.$el = $el;
    this.$loading = this.$el.find('#artistViewLoading');
    this.$loadingStatus = this.$el.find('#artistViewLoadingStatus');
    this.$picture = this.$el.find('#artistViewPicture');
    this.$pictureBlur = this.$el.find('#artistViewPictureBlur');
    this.$name = this.$el.find('#artistViewName');
    this.$disambiguation = this.$el.find('#artistViewDisambiguation');
    this.$years = this.$el.find('#artistViewYears');
    this.$bio = this.$el.find('#artistViewBio');
    this.$gallery = this.$el.find('#artistViewImageGallery');
    this.$discography = this.$el.find('#artistDiscography');
    this.$prevImageButton = this.$el.find('#artistViewPrevImageButton');
    this.$nextImageButton = this.$el.find('#artistViewNextImageButton');
    this.$backButton = $('#backToLibraryButton');
    this._backgroundRequestToken = 0;
    this._loadRequestToken = 0;
    this._renderRequestToken = 0;
    this._reloadOperationToken = 0;

    this.artist = null;
    this.artistImageUrls = [];
    this.artistImageIndex = 0;

    this.$gallery.on('click', '.artistImageThumb', (e) => {
      const $t = $(e.currentTarget);
      const imgId = $t.data('image-id');
      const index = this.artistImageUrls.findIndex(img => img.id === imgId);
      if (index !== -1) {
        this.setArtistImageByIndex(index);
      }
    });

    // react to settings changes for overlay visibility
    $(document).on('settings-show-play-button-changed settings-show-format-overlay-changed', () => this.updateOverlayVisibility());

    this.$el.on('click', '#artistViewSetDefaultImage', () => {
      const img = this.artistImageUrls[this.artistImageIndex];
      const imageId = img ? img.id : null;
      console.log('[artist-view] Set default image clicked:', { imageId, artistId: this.artist && this.artist.id, imgIndex: this.artistImageIndex });
      if (!this.artist || !this.artist.id || !imageId) {
        console.warn('[artist-view] Cannot set default image - missing data');
        return;
      }

      const $btn = this.$el.find('#artistViewSetDefaultImage');
      $btn.prop('disabled', true).addClass('is-loading');

      const $frame = this.$el.find('.artistPictureFrame');
      $frame.addClass('is-setting-default');
      setTimeout(() => $frame.removeClass('is-setting-default'), 1200);

      fetch(`/endpoints/artist?setDefaultImage&id=${encodeURIComponent(this.artist.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_id: imageId })
      }).then(res => res.json()).then(j => {
        console.log('[artist-view] Set default image result:', j);
        if (j.result) {
          this.artist.default_image_id = imageId;
          // Update thumbnails selection
          this.$gallery.find('.artistImageThumb').removeClass('is-selected');
          this.$gallery.find(`.artistImageThumb[data-image-id="${imageId}"]`).addClass('is-selected');
          
          $(document).trigger('toast', { message: 'Default artist image updated' });
          // We don't necessarily need to full reload, but it ensures everything is in sync
          // However, let's just update the local state to be snappy
        }
      }).catch(e => {
        console.error('[artist-view] Set default image error:', e);
      }).finally(() => {
        $btn.prop('disabled', false).removeClass('is-loading');
      });
    });

    this.$prevImageButton.on('click', (e) => {
      e.stopPropagation();
      this.setArtistImageByIndex(this.artistImageIndex - 1);
    });
    this.$nextImageButton.on('click', (e) => {
      e.stopPropagation();
      this.setArtistImageByIndex(this.artistImageIndex + 1);
    });

    this.$backButton.on('click', () => {
      $(document).trigger('show-library');
    });

    this.onPrevImageClick = (e) => {
      e.stopPropagation();
      this.setArtistImageByIndex(this.artistImageIndex - 1);
    };
    this.onNextImageClick = (e) => {
      e.stopPropagation();
      this.setArtistImageByIndex(this.artistImageIndex + 1);
    };
  }

  updateOverlayVisibility() {
    const showPlayButton = Settings.showPlayButton;
    const showFormatOverlay = Settings.showFormatOverlay;
    const $items = this.$discography.find('.artistDiscItem');
    $items.each((i, it) => {
      const $it = $(it);
      if (showPlayButton) $it.addClass('show-play-button'); else $it.removeClass('show-play-button');
      if (showFormatOverlay) $it.addClass('show-format-overlay'); else $it.removeClass('show-format-overlay');
    });
  }

  showFor(artistId) {
    super.show();
    this.loadArtist(artistId);
  }

  show(artistId) {
    if (!artistId) {
      try {
        artistId = sessionStorage.getItem('hqpwv:reloadArtistId') || localStorage.getItem('hqpwv:lastArtistId');
        if (sessionStorage.getItem('hqpwv:reloadArtistId')) {
          sessionStorage.removeItem('hqpwv:reloadArtistId');
        }
      } catch (e) {
        artistId = localStorage.getItem('hqpwv:lastArtistId');
      }
    }

    super.show();
    this.clearView();

    this.$prevImageButton.off('click tap').on('click tap', this.onPrevImageClick);
    this.$nextImageButton.off('click tap').on('click tap', this.onNextImageClick);
    this.$picture.off('click tap').on('click tap', () => $(document).trigger('album-picture-click', {
      $sourceImage: this.$picture,
      artist: this.artist,
      images: this.artistImageUrls,
      currentIndex: this.artistImageIndex,
      coverCount: (this.artistImageUrls || []).length
    }));

    if (artistId) {
      localStorage.setItem('hqpwv:lastArtistId', artistId);
      this.$name.text(`Searching: ${artistId}...`);
      this.loadArtist(artistId);
    }
  }

  setArtistImageByIndex(index) {
    if (!this.artistImageUrls || this.artistImageUrls.length === 0) {
      this.artistImageIndex = 0;
      this.$picture.attr('src', '/img/pixel-transparent.png');
      this.$pictureBlur.attr('src', '/img/pixel-transparent.png');
      this.updateBackgroundImage('/img/pixel-transparent.png');
      this.updateImageNav();
      return;
    }
    const max = this.artistImageUrls.length - 1;
    this.artistImageIndex = Math.max(0, Math.min(index, max));
    const currentImg = this.artistImageUrls[this.artistImageIndex];
    const url = currentImg.url || currentImg.proxyUrl;
    const sourceMap = { wikipedia: 'Wikipedia', commons: 'Commons', lastfm: 'Last.fm' };
    const sourceName = currentImg.source ? (sourceMap[currentImg.source] || currentImg.source.charAt(0).toUpperCase() + currentImg.source.slice(1)) : 'Image';
    this.$picture.attr('src', url).attr('title', sourceName);
    this.$pictureBlur.attr('src', url);
    this.updateBackgroundImage(url, currentImg);
    this.updateImageNav();
  }

  updateBackgroundImage(url, img = null) {
    const $bg = this.$el.find('#artistViewBgImage');
    if ($bg.length) {
      let bgUrl = url;
      if (img && this.artist && this.artist.id && img.id) {
        bgUrl = `/endpoints/artistImage?artist_id=${encodeURIComponent(this.artist.id)}&image_id=${encodeURIComponent(img.id)}&background=1&_bgcb=${Date.now()}`;
      } else if (url.includes('/endpoints/artistImage?')) {
        bgUrl = `${url}&background=1&_bgcb=${Date.now()}`;
      }
      const requestToken = ++this._backgroundRequestToken;
      const preloader = new Image();
      preloader.onload = () => {
        if (requestToken !== this._backgroundRequestToken) return;
        $bg.attr('src', bgUrl).removeClass('is-hidden');
      };
      preloader.onerror = () => {
        if (requestToken !== this._backgroundRequestToken) return;
        $bg.addClass('is-hidden');
      };
      preloader.src = bgUrl;
    }
  }

  updateImageNav() {
    const count = (this.artistImageUrls || []).length;
    const show = count > 1;
    this.$prevImageButton.css('display', 'flex');
    this.$nextImageButton.css('display', 'flex');
    this.$el.find('#artistViewImageNav').toggleClass('is-single', !show);
    this.$prevImageButton.toggleClass('isGhost', this.artistImageIndex <= 0);
    this.$nextImageButton.toggleClass('isGhost', this.artistImageIndex >= count - 1);
    this.$gallery.find('.artistImageThumb').removeClass('is-selected');
    const navImg = this.artistImageUrls[this.artistImageIndex];
    if (navImg && navImg.id) {
      this.$gallery.find(`.artistImageThumb[data-image-id="${navImg.id}"]`).addClass('is-selected');
    }

    // Update "Set Default" button visibility and label
    const $setDefaultBtn = this.$el.find('#artistViewSetDefaultImage');
    if ($setDefaultBtn.length && this.artist) {
      const currentImg = this.artistImageUrls[this.artistImageIndex];
      const isDefault = currentImg && String(currentImg.id) === String(this.artist.default_image_id);
      // Only show the button when there are at least two images and the current
      // image is not already the default. If it's default, hide the button.
      if (isDefault) {
        $setDefaultBtn.hide();
      } else {
        $setDefaultBtn.text('Set as default image').removeClass('is-active').prop('disabled', false).show();
      }
      if (count <= 1) $setDefaultBtn.hide();
    }
  }

  clearView() {
    this.$name.text('');
    this.$disambiguation.text('');
    this.$years.text('');
    this.$bio.html('');
    this.$picture.attr('src', '');
    this.$pictureBlur.attr('src', '');
    this.$gallery.empty();
    // Ensure a single 'Discography' heading sits above the album grid
    this.$discography.prev('.artistDiscographyTitle').remove();
    this.$discography.before('<h3 class="artistDiscographyTitle">Discography</h3>');
    this.$discography.empty();
    this.$el.find('.artist-bio-source').remove();
    this.$el.find('.artist-fetch-more').remove();
    this.$el.find('.artist-error').remove();
    this.$prevImageButton.hide();
    this.$nextImageButton.hide();
    this.artistImageUrls = [];
    this.artistImageIndex = 0;
  }

  showError(artistId) {
    this.$name.text(artistId || 'Unknown Artist');
    this.$disambiguation.text('Profile unavailable');
    this.$loading.hide();
    this.$backButton.show();
    
    // Create the error block securely without inline onclick executing in global scope
    const $err = $(`<div class="artist-error">
       Could not find or import detailed profile data for this artist.<br><br>
       <button class="btn-secondary" id="retryArtistSearchBtn">Retry Search</button>
    </div>`);
    
    this.$bio.empty().append($err);
    
    this.$bio.find('#retryArtistSearchBtn').on('click', () => {
      // Re-trigger the artist fetch
      $(document).trigger('show-artist', artistId);
    });
  }

  hide() {
    this._backgroundRequestToken++;
    this._loadRequestToken++;
    this._renderRequestToken++;
    this._reloadOperationToken++;
    // persist current view state (image index, scroll position) so returning restores last state
    try {
      if (this.artist && this.artist.id) {
        const state = {
          imageIndex: this.artistImageIndex || 0,
          scrollTop: this.$el.scrollTop() || 0
        };
        sessionStorage.setItem(`hqpwv:artistState:${this.artist.id}`, JSON.stringify(state));
      }
    } catch (e) {
      // ignore storage errors
    }
    super.hide();
  }

  setDisplayedImage(url) {
    this.$picture.attr('src', url);
    this.$pictureBlur.attr('src', url);
    this.updateBackgroundImage(url);
  }

  applyArtistData(artist) {
    if (!artist) return;
    this.artist = artist;
    this.renderArtist(artist);
  }

  async ensureArtistReadyForRender(artist) {
    return artist || null;
  }

  loadArtist(artistId) {
    if (!artistId) return;
    this._reloadOperationToken++;
    const requestToken = ++this._loadRequestToken;
    const isCurrentRequest = () => requestToken === this._loadRequestToken;
    this.$loading.css('display', 'flex');
    this.$backButton.hide();
    // If the provided identifier is not a MusicBrainz UUID, treat it as a name
    const isMbUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artistId);
    const fetchArtistJson = () => {
      return fetch(`/endpoints/artist?get&id=${encodeURIComponent(artistId)}`).then(res => {
        if (res.status === 404) return null;
        return res.json();
      });
    };

    if (!isMbUuid) {
      // First check cache by name, only import if not found
      fetch('/endpoints/artist?name=' + encodeURIComponent(artistId))
        .then(res => {
          if (!res.ok) return null;
          return res.json();
        })
        .then(async data => {
          if (!isCurrentRequest()) return;
          if (data && data.artist) {
            // Found in cache
            const renderableArtist = await this.ensureArtistReadyForRender(data.artist);
            if (!isCurrentRequest()) return;
            this.$loading.hide();
            this.$backButton.show();
            if (this.$imageSpinner) this.$imageSpinner.hide();
            this.applyArtistData(renderableArtist);
          } else {
            // Not in cache, import from external sources
            this.importArtist(artistId, requestToken);
          }
        }).catch((e) => {
          if (!isCurrentRequest()) return;
          console.error('Artist cache lookup error:', e);
          this.importArtist(artistId, requestToken);
        });
      return;
    }

    // Try to load by id first; if not found, attempt import by name
    fetchArtistJson()
      .then(async json => {
        if (!isCurrentRequest()) return;
        if (json && json.artist) {
          const renderableArtist = await this.ensureArtistReadyForRender(json.artist);
          if (!isCurrentRequest()) return;
          this.$loading.hide();
          this.$backButton.show();
          this.applyArtistData(renderableArtist);
        } else {
          this.$loading.hide();
          this.$backButton.show();
          this.showError(artistId);
        }
      }).catch((e) => {
        if (!isCurrentRequest()) return;
        console.error('Artist fetch error:', e);
        this.$loading.hide();
        this.showError(artistId);
      });
  }

  importArtist(artistId, requestToken = this._loadRequestToken) {
    const isCurrentRequest = () => requestToken === this._loadRequestToken;
    if (this.$loadingStatus) this.$loadingStatus.text('Importing artist data...');
    fetch('/endpoints/artistImport?wait=1&source=artist-load&releaseLimit=' + encodeURIComponent(Settings.artistReleaseLimit) + '&imageLimit=' + encodeURIComponent(Settings.artistImageLimit) + '&name=' + encodeURIComponent(artistId), { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(async j => {
        if (!isCurrentRequest()) return;
        if (!j) throw new Error('Import request failed');
        if (!j.id) {
          throw new Error('Unexpected import response');
        }
        if (this.$loadingStatus) this.$loadingStatus.text('Loading imported artist...');
        if (!isCurrentRequest()) return;
        const artistRes = await fetch('/endpoints/artist?get&id=' + encodeURIComponent(j.id));
        if (!artistRes.ok) {
          throw new Error('Imported artist fetch failed');
        }
        const artistJson = await artistRes.json();
        if (!isCurrentRequest()) return;
        if (!(artistJson && artistJson.artist)) {
          throw new Error('Imported artist missing');
        }
        const renderableArtist = await this.ensureArtistReadyForRender(artistJson.artist);
        if (!isCurrentRequest()) return;
        this.applyArtistData(renderableArtist);
        this.$loading.hide();
        this.$backButton.show();
        if (this.$loadingStatus) this.$loadingStatus.text('');
      }).catch((e) => {
        if (!isCurrentRequest()) return;
        console.error('Artist import error:', e);
        this.$loading.hide();
        if (this.$loadingStatus) this.$loadingStatus.text('Import failed');
        this.showError(artistId);
      });
  }

  getKnownArtists() {
    if (!Model.hasLibrary) return [];
    const artists = new Set();
    for (const album of Model.library.albums) {
      if (album['@_artist']) artists.add(album['@_artist']);
      if (album['@_performer']) artists.add(album['@_performer']);
    }
    const excluded = new Set(Values.EXCLUDED_ARTISTS);
    return Array.from(artists).filter(a => !excluded.has(a.toLowerCase()));
  }

  getKnownAlbums(artistName) {
    if (!Model.hasLibrary || !artistName) return [];
    const albums = [];
    const normArtist = artistName.toLowerCase();
    for (const album of Model.library.albums) {
      const albumArtist = album['@_artist'] || album['@_performer'] || '';
      if (albumArtist.toLowerCase() === normArtist && album['@_album']) {
        albums.push(album['@_album']);
      }
    }
    return albums;
  }

  linkifyBio(bio, $el) {
    if (!bio) {
      $el.empty();
      return;
    }

    const cutoffPatterns = [
      /\n\n+Discography\s*[:|\n]/i,
      /\n\n+Selected\s+discography/i,
      /\n\n+Studio\s+albums/i,
      /\n\n+Awards?\s*[:|\n]/i,
      /\n\n+Bibliography/i,
      /\n\n+Filmography/i,
      /\n\n+==\s*(Discography|Awards?|Bibliography|Filmography)\s*==/i
    ];

    let cutoffIndex = -1;
    for (const pattern of cutoffPatterns) {
      const match = bio.match(pattern);
      if (match && (cutoffIndex === -1 || match.index < cutoffIndex)) {
        cutoffIndex = match.index;
      }
    }

    let processedBio;
    const bioWithoutCutoff = cutoffIndex === -1 ? bio : bio.substring(0, cutoffIndex);
    const bioLimit = Settings.artistBioLimit || 4000;

    if (bioWithoutCutoff.length < bioLimit) {
      processedBio = bioWithoutCutoff;
    } else {
      processedBio = bio;
      if (processedBio.includes('__SUMMARY_END__')) {
        processedBio = processedBio.split('__SUMMARY_END__')[0];
      } else {
        const origParagraphs = processedBio.split(/\n\n+/);
        if (origParagraphs.length > 2) {
          processedBio = origParagraphs.slice(0, 2).join('\n\n');
        }
      }
    }

      // split into paragraphs and clean up section-like headings
      let paragraphs = processedBio.split(/\n+/).map(p => p.trim()).filter(Boolean);
      
      // If we got only one paragraph, try to split it by sentences if it's long
      if (paragraphs.length === 1 && paragraphs[0].length > 300) {
        const sentences = paragraphs[0].split(/([.])\s+(?=[A-Z])/);
        if (sentences.length > 1) {
          paragraphs = sentences.map(s => s.trim()).filter(Boolean);
        }
      }
      const filtered = paragraphs.filter(p => {
        if (/^={2,}/.test(p) || /^={2,}.*={2,}$/.test(p)) return false;
        const words = p.split(/\s+/).filter(Boolean);
        const isShortHeading = (words.length <= 3 && /^[A-Z\-:\s]+$/.test(p)) || /:\s*$/.test(p);
        const isSingleWordCommon = /^(Biography|Discography|Life|Overview|Works)$/i.test(p);
        return !(isShortHeading || isSingleWordCommon);
      });
      const htmlBio = filtered.length > 0 
          ? filtered.map(p => `<p>${Util.formatMetaHtml(p, false)}</p>`).join('')
          : paragraphs.length > 0 
            ? paragraphs.map(p => `<p>${Util.formatMetaHtml(p, false)}</p>`).join('')
            : `<p>${Util.formatMetaHtml(processedBio, false)}</p>`;

    const artists = this.getKnownArtists();
    const artistNamesLower = new Set(artists.map(a => a.toLowerCase()));
    // Sort by length longest first to avoid partial matching issues
    artists.sort((a, b) => b.length - a.length);

    // To prevent double-linking, we'll replace names with placeholders first
    const placeholders = [];
    let linkedHtml = htmlBio;

    for (const name of artists) {
      if (name === this.artist.name || name.length < 4) continue; // skip very short names
      
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedName}\\b`, 'gi');
      
      if (regex.test(linkedHtml)) {
        const placeholder = `__ARTIST_${placeholders.length}__`;
        placeholders.push({ placeholder, name });
        linkedHtml = linkedHtml.replace(regex, placeholder);
      }
    }

    // Now replace placeholders with links
    for (const item of placeholders) {
      linkedHtml = linkedHtml.replace(new RegExp(item.placeholder, 'g'), `<a class="artist-link" data-artist-name="${Util.escapeHtml(item.name)}">${Util.escapeHtml(item.name)}</a>`);
    }

    // Album linking - only albums from the current artist
    const albums = this.getKnownAlbums(this.artist.name);
    albums.sort((a, b) => b.length - a.length);

    for (const title of albums) {
      if (title.length < 3) continue;
      // Skip if this album title is already an artist name (avoid double-linking)
      if (artistNamesLower.has(title.toLowerCase())) continue;
      
      const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedTitle}\\b`, 'gi');
      
      if (regex.test(linkedHtml)) {
        const placeholder = `__ALBUM_${placeholders.length}__`;
        placeholders.push({ placeholder, title });
        linkedHtml = linkedHtml.replace(regex, placeholder);
      }
    }

    // Replace album placeholders with links
    for (const item of placeholders) {
      if (item.title) {
        const displayTitle = item.title.replace(/\s+/g, '\u00A0'); // non-breaking spaces
        linkedHtml = linkedHtml.replace(new RegExp(item.placeholder, 'g'), `<a class="album-link" data-album-title="${Util.escapeHtml(item.title)}">${displayTitle}</a>`);
      }
    }

    $el.html(linkedHtml);
    $el.find('.artist-link').on('click', (e) => {
      const artistName = $(e.currentTarget).data('artist-name');
      // Prevent recursion if it's the same artist
      if (artistName === this.artist.name) return;
      $(document).trigger('show-artist', artistName);
    });

    $el.find('.album-link').on('click', (e) => {
      const albumTitle = $(e.currentTarget).data('album-title');
      if (!albumTitle || !Model.hasLibrary) return;
      const album = Model.library.getAlbumByTitleAndArtist(albumTitle, this.artist.name);
      if (album) {
        $(document).trigger('show-album', album['@_hash']);
      }
    });

    return bioWithoutCutoff.length >= bioLimit;
  }

  async renderArtist(artist) {
    const renderToken = ++this._renderRequestToken;
    const isCurrentRender = () => renderToken === this._renderRequestToken;
    this.$name.text(artist.name || '');
    this.$disambiguation.text(artist.disambiguation || '');
    
    let years = '';
    if (artist.life_span && (artist.life_span.begin || artist.life_span.end || (typeof artist.life_span.ended !== 'undefined'))) {
      const begin = artist.life_span.begin ? artist.life_span.begin.substring(0, 4) : '';
      let end = '';
      if (artist.life_span.end) {
        end = artist.life_span.end.substring(0, 4);
      } else if (artist.life_span.ended === false) {
        end = 'Present';
      }
      years = begin ? `${begin}${end ? ' – ' + end : ''}` : '';
    }
    this.$years.text(years);
    const isBioTruncated = this.linkifyBio(artist.bio, this.$bio);

    // show biography source in faint text and link to original when available
    this.$el.find('.artist-bio-source').remove();
    this.$el.find('.artist-bio-readmore').remove();
    const sources = [];
    if (artist.wiki_url) {
      sources.push(`<span class="sourceItem"><span class="metaCaption">Biography</span> <span class="metaValue"><a href="${artist.wiki_url}" target="_blank" rel="noopener">Wikipedia</a></span></span>`);
    }
    if (artist.id) {
      const mbUrl = `https://musicbrainz.org/artist/${encodeURIComponent(artist.id)}`;
      sources.push(`<span class="sourceItem"><span class="metaCaption">Discography</span> <span class="metaValue"><a href="${mbUrl}" target="_blank" rel="noopener">MusicBrainz</a></span></span>`);
    }

    // create container now; we'll append extra 'more info' result async if found
    if (sources.length) {
      if (isBioTruncated && artist.wiki_url) {
        const $readMore = $(`<div class="artist-bio-readmore text-2">Read full biography on <a class="artist-link" href="${artist.wiki_url}" target="_blank" rel="noopener">Wikipedia</a> <span class="readMoreArrow">↗</span></div>`);
        this.$bio.after($readMore);
      }

      const $sourceContainer = $(`<div class="artist-bio-source text-3"></div>`);
      // Each source on its own line for vertical stacking
      for (const s of sources) {
        $sourceContainer.append(`<div class="sourceItemRow">${s}</div>`);
      }
      // Place the source container into the left hero block at the bottom
      const $pictureOuter = this.$el.find('.artistViewPictureOuter');
      if ($pictureOuter.length) {
        $pictureOuter.append($sourceContainer);
      } else {
        // fallback: keep it near the bio if picture outer isn't found
        this.$bio.after($sourceContainer);
      }

      (async () => {
        try {
          const q = encodeURIComponent(artist.name || '');
          const proxyUrl = `/endpoints/proxyFetch?url=${encodeURIComponent('https://www.allmusic.com/search/all/' + q)}`;
          const res = await fetch(proxyUrl);
          if (!res.ok) return;
          const text = await res.text();
          if (!isCurrentRender()) return;
          let url = null;
          const re = /href="(https?:\/\/www\.allmusic\.com\/[^"]+)"/gi;
          let match;
          let first = null;
          const preferPath = /(\/artist\/|\/album\/|\/song\/|\/release\/)/i;
          while ((match = re.exec(text)) !== null) {
            if (!first) first = match[1];
            try {
              const u = new URL(match[1]);
              if (preferPath.test(u.pathname)) {
                url = match[1];
                break;
              }
            } catch (e) {}
          }
          if (!url && first) url = first;
          if (url) {
            if (!isCurrentRender()) return;
            const $more = $(`<div class="sourceItemRow"><span class="sourceItem"><span class="metaCaption">More info</span> <span class="metaValue"><a href="${url}" target="_blank" rel="noopener">AllMusic</a></span></span></div>`);
            $sourceContainer.append($more);
          }
        } catch (e) {}
      })();
    }

    // images
    this.artistImageUrls = [];
    this.$gallery.empty();
    if (artist.images && artist.images.length) {
      const seen = new Set();
      const isReleaseCoverId = (id) => typeof id === 'string' && id.includes('-rel-');
      const resolveSourceFromId = (img) => {
        if (img && img.source) return img.source;
        const id = img && img.id ? String(img.id) : '';
        if (id.endsWith('-wiki')) return 'wikipedia';
        if (id.includes('-comm-')) return 'commons';
        if (id.includes('-lastfm-')) return 'lastfm';
        return null;
      };
      const allowedSources = new Set(['wikipedia', 'commons', 'lastfm']);
      const desiredDefaultId = artist.default_image_id;
      for (const img of artist.images) {
        if (!img.url) { console.log('[artist-view] Skip - no url:', img.id); continue; }
        if (isReleaseCoverId(img.id)) { console.log('[artist-view] Skip - release cover:', img.id); continue; }
        const src = resolveSourceFromId(img);
        if (!src || (!allowedSources.has(src) && String(img.id) !== String(desiredDefaultId))) { 
          console.log('[artist-view] Skip - source rejected:', { id: img.id, src, allowed: [...allowedSources], defaultId: desiredDefaultId }); 
          continue; 
        }
        const proxyUrl = `/endpoints/artistImage?artist_id=${encodeURIComponent(artist.id)}&image_id=${encodeURIComponent(img.id)}&_cb=${Date.now()}`;
        if (seen.has(img.url)) continue;
        seen.add(img.url);
        this.artistImageUrls.push({ id: img.id, proxyUrl, source: src });
      }
    }

    const defaultImageId = artist.default_image_id || (this.artistImageUrls[0] && this.artistImageUrls[0].id);
    this.artistImageIndex = Math.max(0, this.artistImageUrls.findIndex(img => img.id === defaultImageId));
    
    if (this.artistImageUrls.length > 0) {
      const currentImg = this.artistImageUrls[this.artistImageIndex];
      this.setDisplayedImage(currentImg.proxyUrl);
      
      // gallery - only if more than 1 image
      if (this.artistImageUrls.length > 1) {
        for (const img of this.artistImageUrls) {
          const $thumb = $(`<div class="artistImageThumb ${img.id === defaultImageId ? 'is-selected' : ''}" data-image-id="${img.id}" data-image-url="${img.proxyUrl}"><img src="${img.proxyUrl}" alt=""></div>`);
          this.$gallery.append($thumb);
        }
      }
    } else {
      this.setDisplayedImage('/img/pixel-transparent.png');
    }
    this.setArtistImageByIndex(this.artistImageIndex);

    // Show 'set as default' button only when multiple artist images are available
    this.$el.find('#artistViewSetDefaultImage').toggle(this.artistImageUrls.length > 1);

    // Create picture controls: reload button + non-local cover mode toggle
    try {
      this.$el.find('.artist-picture-controls').remove();
      const $controlsContainer = this.$el.find('#artistViewPictureControls');
      if ($controlsContainer && $controlsContainer.length) {
        $controlsContainer.empty();
        const $controls = $(`<div class="artist-picture-controls"></div>`);
        
        const modeKey = `hqpwv:artist:${artist.id}:nonLocalCoverMode`;
        const curMode = localStorage.getItem(modeKey) || 'legacy';
        const initialLabel = curMode === 'fullcolor' ? 'Full color covers' : 'Faded covers';
        
        const $modeToggle = $(`
          <label class="toggle-switch" title="Toggle non-local cover mode">
            <input type="checkbox" id="artistCoverModeToggle" ${curMode === 'fullcolor' ? 'checked' : ''}>
            <div class="toggle-track"></div>
            <div class="toggle-thumb"></div>
          </label>
        `);
        const $modeLabel = $(`<span class="mode-label">${initialLabel}</span>`);
        
        const $reloadBtn = $(`<button class="iconButton" id="artistReloadButton" title="Reload artist data" aria-label="Reload artist data"></button>`);
        
        $controls.append($modeLabel);
        $controls.append($modeToggle);
        $controlsContainer.append($controls);

        this.$name.after($reloadBtn);

        // reload action - clear existing artist data first, then perform one full awaited import
        $reloadBtn.on('click', async () => {
          const reloadToken = ++this._reloadOperationToken;
          const isCurrentReload = () => reloadToken === this._reloadOperationToken;
          $reloadBtn.prop('disabled', true).addClass('is-loading');

          if (this.$loadingStatus) this.$loadingStatus.text('Reloading: starting...');

          try {
            const clearRes = await fetch(`/endpoints/artist?clearCache&id=${encodeURIComponent(artist.id)}`, { method: 'POST' });
            if (!clearRes.ok) throw new Error('Cache clear failed');
            if (!isCurrentReload()) throw new Error('Reload superseded');

            if (this.$loadingStatus) this.$loadingStatus.text('Reloading artist data...');
            const importRes = await fetch('/endpoints/artistImport?wait=1&source=reload-button&releaseLimit=' + encodeURIComponent(Settings.artistReleaseLimit) + '&imageLimit=' + encodeURIComponent(Settings.artistImageLimit) + '&name=' + encodeURIComponent(artist.name), { method: 'POST' });
            if (!importRes.ok) throw new Error('Import request failed');
            const importJson = await importRes.json();
            if (!isCurrentReload()) throw new Error('Reload superseded');
            if (!(importJson && importJson.id)) throw new Error('Import response missing artist id');
            if (!isCurrentReload()) throw new Error('Reload superseded');
            if (this.$loadingStatus) this.$loadingStatus.text('Loading refreshed artist...');
            const artistRes = await fetch(`/endpoints/artist?get&id=${encodeURIComponent(importJson.id)}`);
            if (!artistRes.ok) throw new Error('Imported artist fetch failed');
            const artistJson = await artistRes.json();
            if (!isCurrentReload()) throw new Error('Reload superseded');
            if (!(artistJson && artistJson.artist && artistJson.artist.id === importJson.id)) {
              throw new Error('Imported artist not available');
            }
            const verifiedArtist = await this.ensureArtistReadyForRender(artistJson.artist);
            if (!isCurrentReload()) throw new Error('Reload superseded');
            this.applyArtistData(verifiedArtist);
            if (this.$loadingStatus) this.$loadingStatus.text('');
            this.$backButton.show();
          } catch (e) {
            if (String(e && e.message) !== 'Reload superseded') {
              console.error('Reload error:', e);
              if (this.$loadingStatus) this.$loadingStatus.text('Reload failed');
            }
          } finally {
            if (isCurrentReload()) {
              $reloadBtn.prop('disabled', false).removeClass('is-loading');
            }
          }
        });

        // mode cycling
        const applyMode = (mode) => {
          try { localStorage.setItem(modeKey, mode); } catch (e) {}
          $modeLabel.text(mode === 'fullcolor' ? 'Full color covers' : 'Faded covers');
          this.$el.removeClass('mode-legacy mode-fullcolor');
          this.$el.addClass('mode-' + mode);
        };
        $modeToggle.find('input').on('change', (e) => {
          const isFullColor = $(e.currentTarget).prop('checked');
          applyMode(isFullColor ? 'fullcolor' : 'legacy');
        });

        // initialize from per-artist storage
        applyMode(localStorage.getItem(modeKey) || 'legacy');
      }
    } catch (e) {
      // ignore UI errors
    }

    // Attempt to restore previously saved state for this artist (image index, scroll)
    try {
      if (artist && artist.id) {
        const raw = sessionStorage.getItem(`hqpwv:artistState:${artist.id}`);
        if (raw) {
          const st = JSON.parse(raw);
          if (st && typeof st.imageIndex === 'number' && this.artistImageUrls.length > 0) {
            const idx = Math.max(0, Math.min(st.imageIndex, this.artistImageUrls.length - 1));
            this.setArtistImageByIndex(idx);
          }
          if (st && typeof st.scrollTop === 'number') {
            this.$el.scrollTop(st.scrollTop);
          }
        }
      }
    } catch (e) {
      // ignore
    }

    // Close zoomed covers when clicking anywhere outside the cover
    $(document).off('click.artistZoom').on('click.artistZoom', (e) => {
      if (!$(e.target).closest('.artistDiscItem.not-local .coverWrap').length) {
        this.$discography.find('.coverWrap.is-zoomed').removeClass('is-zoomed');
      }
    });

    // discography
    this.$discography.empty();

    // Build remote releases (from server discography or synthesized from images)
    let remoteReleases = [];
    if (Array.isArray(artist.discography) && artist.discography.length) {
      remoteReleases = artist.discography.map(d => ({...d, _source: 'mb'}));
    } else if (Array.isArray(artist.images) && artist.images.length) {
      const relImgs = artist.images.filter(i => i && String(i.id).indexOf(`${artist.id}-rel-`) === 0);
      if (relImgs.length > 0) {
        remoteReleases = relImgs.map(img => {
          const relId = String(img.id).substring((artist.id + '-rel-').length);
          return { id: relId, title: '', year: '', cover_url: img.thumbnail_url || img.url || null, _source: 'synth' };
        });
      }
    }

    // Gather local albums for this artist
    const localAlbums = [];
    if (Model.hasLibrary) {
      for (const album of Model.library.albums) {
        const localArtistName = (album['@_artist'] || album['@_performer'] || '').toLowerCase();
        const searchArtistName = artist.name.toLowerCase();
        const isArtistMatch = localArtistName.includes(searchArtistName) || searchArtistName.includes(localArtistName);
        if (isArtistMatch) {
          localAlbums.push(album);
        }
      }
    }

    // Group toFetch releases to be handled after initial render
    const toFetch = remoteReleases.filter(r => (!r.title || r.title === '') && r.id);
    // remove unknown releases from initial list to allow rendering what we HAVE
    remoteReleases = remoteReleases.filter(r => r.title && r.title !== '');

    // Merge local and remote releases with fuzzy matching so small title differences
    // still collapse to one item. When both sides have a year, the remote year wins.
    const normalize = (s) => String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' and ')
      .replace(/\b(deluxe|edition|expanded|remaster(?:ed)?|mono|stereo|anniversary|bonus track?s?)\b/g, ' ')
      .replace(/[^\w\s]/g, ' ')
      .replace(/[\s\u00A0]+/g, ' ')
      .trim();
    const toYearString = (value) => {
      const match = String(value || '').match(/\b(19|20)\d{2}\b/);
      return match ? match[0] : '';
    };
    const tokenize = (s) => normalize(s).split(' ').filter(Boolean);
    const getLocalYear = (album) => toYearString(album['@_year'] || album['year'] || (album['@_date'] ? album['@_date'].substring(0, 4) : ''));
    const levenshtein = (a, b) => {
      const aa = String(a || '');
      const bb = String(b || '');
      if (!aa) return bb.length;
      if (!bb) return aa.length;
      const dp = Array.from({ length: aa.length + 1 }, () => new Array(bb.length + 1).fill(0));
      for (let i = 0; i <= aa.length; i++) dp[i][0] = i;
      for (let j = 0; j <= bb.length; j++) dp[0][j] = j;
      for (let i = 1; i <= aa.length; i++) {
        for (let j = 1; j <= bb.length; j++) {
          const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + cost
          );
        }
      }
      return dp[aa.length][bb.length];
    };
    const getTitleSimilarity = (aTitle, bTitle, artistName = '') => {
      let aNorm = normalize(aTitle);
      const bNorm = normalize(bTitle);
      
      // Remove artist name from local album title if present
      if (artistName && artistName.trim()) {
        const artistNorm = normalize(artistName);
        const artistWords = artistNorm.split(/\s+/).filter(w => w.length > 2);
        for (const word of artistWords) {
          const regex = new RegExp(`(?:^|\\s)${word}(?:\\s|$)`, 'gi');
          aNorm = aNorm.replace(regex, ' ').replace(/\s+/g, ' ').trim();
        }
      }
      
      if (!aNorm || !bNorm) return 0;
      if (aNorm === bNorm) return 1;
      const aTokens = tokenize(aNorm);
      const bTokens = tokenize(bNorm);
      const aSet = new Set(aTokens);
      const bSet = new Set(bTokens);
      let intersection = 0;
      for (const token of aSet) {
        if (bSet.has(token)) intersection++;
      }
      const tokenScore = intersection / Math.max(aSet.size || 1, bSet.size || 1);
      const distance = levenshtein(aNorm, normalize(bTitle));
      const lengthScore = 1 - (distance / Math.max(aNorm.length, bNorm.length, 1));
      return Math.max(tokenScore, lengthScore);
    };
    const isLikelySameRelease = (localAlbum, remoteRelease) => {
      const similarity = getTitleSimilarity(localAlbum['@_album'], remoteRelease.title, artist.name);
      if (similarity >= 0.97) return true;
      if (similarity >= 0.9) return true;
      if (similarity >= 0.82) {
        const localNorm = normalize(localAlbum['@_album']);
        const remoteNorm = normalize(remoteRelease.title);
        if (localNorm.includes(remoteNorm) || remoteNorm.includes(localNorm)) return true;
      }
      return false;
    };
    const localEntries = localAlbums.map((album) => ({
      type: 'local',
      album,
      displayYear: null,
      matchedRelease: null
    }));
    const matchedRemoteIndexes = new Set();
    const matchedLocalIndexes = new Set();

    for (let li = 0; li < localEntries.length; li++) {
      const localEntry = localEntries[li];
      const localTitle = localEntry.album['@_album'];
      const localNorm = normalize(localTitle);
      let bestMatch = null;
      
      // Find all matching remote releases (same normalized title)
      for (let i = 0; i < remoteReleases.length; i++) {
        const remoteRelease = remoteReleases[i];
        if (!remoteRelease || !remoteRelease.title) continue;
        const remoteNorm = normalize(remoteRelease.title);
        if (localNorm === remoteNorm) {
          matchedRemoteIndexes.add(i);
          if (!bestMatch || (bestMatch.score && bestMatch.score < 1)) {
            bestMatch = { index: i, release: remoteRelease, score: 1 };
          }
        }
      }
      if (bestMatch) {
        matchedLocalIndexes.add(li);
        localEntry.matchedRelease = bestMatch.release;
        localEntry.displayYear = toYearString(bestMatch.release.year) || null;
      }
    }

    const renderAll = () => {
      this.$discography.empty();
      const merged = [];
      const seenLocal = new Set();
      const seenRemote = new Set();

      for (let li = 0; li < localEntries.length; li++) {
        const localEntry = localEntries[li];
        const key = `${normalize(localEntry.album['@_album'])}|${localEntry.album['@_year']||''}`;
        if (seenLocal.has(key)) continue;
        seenLocal.add(key);
        merged.push(localEntry);
      }

      for (let i = 0; i < remoteReleases.length; i++) {
        if (matchedRemoteIndexes.has(i)) continue;
        const r = remoteReleases[i];
        const key = `${normalize(r.title)}|${String(r.year||'')}`;
        if (seenLocal.has(key)) continue;
        if (seenRemote.has(key)) continue;
        seenRemote.add(key);
        merged.push({ type: 'remote', release: r });
      }

      merged.sort((a, b) => {
        const getYear = (x) => {
          if (x.displayYear) return parseInt(x.displayYear) || 0;
          if (x.type === 'local') {
            const alb = x.album;
            return parseInt(alb['@_year']) || alb['year'] || (alb['@_date'] ? parseInt(alb['@_date'].substring(0,4)) : 0) || 0;
          }
          return parseInt(x.release.year) || 0;
        };
        const ay = getYear(a);
        const by = getYear(b);
        if (ay !== by) return ay - by;
        const at = a.type === 'local' ? normalize(a.album['@_album']) : normalize(a.release.title);
        const bt = b.type === 'local' ? normalize(b.album['@_album']) : normalize(b.release.title);
        return at.localeCompare(bt);
      });

      for (const item of merged) {
        this.renderDiscographyItem(item, artist);
      }
    };

    renderAll();

    // Background enrichment for synthesized releases
    if (toFetch.length > 0) {
      (async () => {
        for (const rSynth of toFetch) {
          if (!isCurrentRender()) return;
          try {
            const res = await fetch(`/endpoints/artist?getRelease&release_id=${encodeURIComponent(rSynth.id)}`);
            if (res.ok) {
              const json = await res.json();
              if (!isCurrentRender()) return;
              if (json && json.release) {
                const r = json.release;
                rSynth.title = r.title || r['title'] || '';
                rSynth.year = r.date ? String(r.date).slice(0,4) : (r.year || '');
                if (rSynth.title) {
                   if (!isCurrentRender()) return;
                   remoteReleases.push({...rSynth});
                   buildRemoteYearMap();
                   renderAll(); 
                }
              }
            }
          } catch (e) { /* ignore */ }
        }
      })();
    }
    this.$el.find('.artist-fetch-more').remove();
  }

  // Refactored discography item rendering to avoid code duplication
  renderDiscographyItem(item, artist) {
      const isLocal = item.type === 'local';
      const albumInLibrary = isLocal ? item.album : (Model.hasLibrary ? Model.library.getAlbumByTitleAndArtist(item.release.title, artist.name) : null);
      let coverUrl = '';
      let fallbackCoverUrl = '';
      if (isLocal) {
        try { coverUrl = DataUtil.getAlbumImageUrl(item.album); } catch (e) { coverUrl = ''; }
      } else {
        const release = item.release;
        if (release.cover_url && release.cover_url !== '') {
          // Use direct cover URL when available to avoid an extra redirect/proxy hop
          // The server also supports the synthetic artistImage endpoint, but using
          // the direct URL prevents issues when the server-side redirect/proxy fails.
          coverUrl = release.cover_url;
          fallbackCoverUrl = release.cover_fallback_url || '';
        } else {
          const relId = String(release.id || '');
          const expectedImageId = `${artist.id}-rel-${relId}`;
          const match = (artist.images || []).find(i => String(i.id) === expectedImageId);
          if (match && match.id) {
            coverUrl = `/endpoints/artistImage?artist_id=${encodeURIComponent(artist.id)}&image_id=${encodeURIComponent(match.id)}`;
          }
        }
      }

      const hasCover = !!coverUrl && coverUrl !== '';
      const coverSrc = hasCover ? coverUrl : '/img/pixel-transparent.png';

      const title = isLocal ? (item.album['@_album'] || '') : (item.release.title || '');
      let year = '';
      if (isLocal) {
        year = item.displayYear || item.album['@_year'] || item.album['year'] || (item.album['@_date'] ? item.album['@_date'].substring(0,4) : '') || '';
      } else {
        year = item.release.year || '';
      }

      const bitsHtml = (isLocal && albumInLibrary) ? AlbumUtil.getBitrateText(albumInLibrary) : '';
      const $item = $(
        `<div class="artistDiscItem ${isLocal ? 'is-local' : 'not-local'}" title="${isLocal ? 'In library' : 'Not in library'}">
          <div class="coverWrap ${!hasCover ? 'no-cover' : ''} ${!isLocal && hasCover ? 'bw' : ''}">
            <img src="${coverSrc}" alt="" loading="lazy">
            ${isLocal ? `<div class="libraryItemPlayBtn" title="Play Album"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>` : ''}
            ${bitsHtml ? `<div class="libraryItemBits">${bitsHtml}</div>` : ''}
          </div>
          <div class="releaseYear">${year ? Util.escapeHtml(year) : '&nbsp;'}</div>
          <div class="releaseTitle">${Util.escapeHtml(title||'')}</div>
        </div>`
      );

      $item.find('img').on('error', function() {
        if (!isLocal && fallbackCoverUrl && this.dataset.fallbackTried !== '1' && this.src !== fallbackCoverUrl) {
          this.dataset.fallbackTried = '1';
          this.src = fallbackCoverUrl;
          return;
        }
        this.src = '/img/pixel-transparent.png';
        if (this.parentElement) this.parentElement.classList.add('no-cover');
      });

      if (isLocal) {
        $item.on('click', () => { $(document).trigger('library-item-click', [item.album, $item]); });
        // Prevent text area from triggering album view - only cover should be clickable
        $item.find('.releaseTitle, .releaseYear').on('click tap', (e) => { e.stopPropagation(); });
        $item.find('.libraryItemPlayBtn').on('click tap', (e) => { e.stopPropagation(); const commands = Commands.playlistAddUsingAlbumAndIndices(item.album, 0, -1); AppUtil.doPlaylistAdds(commands, true, true); });
      } else if (hasCover) {
        $item.find('.coverWrap').on('click tap', (e) => {
          const $cover = $(e.currentTarget);
          if ($cover.hasClass('is-zoomed')) {
            $cover.removeClass('is-zoomed');
          } else {
            this.$discography.find('.coverWrap.is-zoomed').removeClass('is-zoomed');
            $cover.addClass('is-zoomed');
          }
        });
      }
      if (Settings.showPlayButton) $item.addClass('show-play-button'); else $item.removeClass('show-play-button');
      if (Settings.showFormatOverlay) $item.addClass('show-format-overlay'); else $item.removeClass('show-format-overlay');
      this.$discography.append($item);
  }


}
