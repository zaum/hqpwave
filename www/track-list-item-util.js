import Util from './util.js';
import Model from './model.js';
import DataUtil from './data-util.js';
import AlbumUtil from './album-util.js';
import MetaUtil from './meta-util.js'

/**
 * Generates track list items.
 * Used for playlist, history, search/track.
 */
export default class TrackListItemUtil {

  /**
   * Returns an array of the generated generated track list items (not including album header lines).
   * Hooks up album buttons,favorite buttons, but not context menu buttons.
   *
   * @param $holder
   * @param array elements must have value for either @_uri, or @_hash/hash
   * @param showDeleteButton whether to show the delete button (default: true)
   */
  static populateList($holder, array, showDeleteButton = true) {
    const result = [];

    for (let i = 0; i < array.length; i++) {

      const $albumLine = TrackListItemUtil.makeAlbumHeaderIfNecessary(i, array, '', '', false, false, false);
      if ($albumLine) {
        $holder.append($albumLine);
        $albumLine.find('.albumLineButton').on('click tap', TrackListItemUtil.onAlbumButton);
      }

      const $item = TrackListItemUtil.makeListItem(i, array, (i+1), showDeleteButton);
      $item.find(".favoriteButton").on("click tap", TrackListItemUtil.onFavoriteButtonClick);
      $holder.append($item);
      result.push($item);
    }

    return result;
  }

  /**
   * Variant for history view.
   *
   * @param $holder
   * @param array elements have properties `data` and `ago`
   */
  static populateHistoryList($holder, tracks, agoStrings, dateKeys = []) {
    const result = [];
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const agoString = agoStrings[i];
      const dateKey = (dateKeys && dateKeys[i]) ? dateKeys[i] : '';
      const datePrev = (i > 0) ? ((dateKeys && dateKeys[i-1]) ? dateKeys[i-1] : '') : '';
      const dateNext = (i < tracks.length - 1) ? ((dateKeys && dateKeys[i+1]) ? dateKeys[i+1] : '') : '';
      const sameDatePrev = dateKey && datePrev && (dateKey === datePrev);
      const sameDateNext = dateKey && dateNext && (dateKey === dateNext);
      const $albumLine = TrackListItemUtil.makeAlbumHeaderIfNecessary(i, tracks, agoString, dateKey, sameDatePrev, sameDateNext);
      if ($albumLine) {
        $holder.append($albumLine);
        $albumLine.find('.albumLineButton').on('click tap', TrackListItemUtil.onAlbumButton);
      }
      let $item;
      if (Object.keys(track).length == 0) {
        $item = TrackListItemUtil.makeNonLibraryHistoryItem(agoString, dateKey, sameDatePrev, sameDateNext);
      } else {
        $item = TrackListItemUtil.makeListItem(i, tracks, agoString, false, true, dateKey, sameDatePrev, sameDateNext); // no delete, hide drag for history
        $item.find(".favoriteButton").on("click tap", TrackListItemUtil.onFavoriteButtonClick);
      }
      $holder.append($item);
      result.push($item);
    }
    return result;
  }

  /**
   * @param item just needs to have either a uri ('@_uri' or 'uri') or a track hash ('@_hash' or 'hash')
   */
  static getAlbumForTrackDataItem(item) {
    if (!item) {
      return null;
    }
    const uri = item['@_uri'] || item['uri'];
    if (uri) {
      return Model.library.getAlbumByTrackUri(uri)
    }
    const hash = item['@_hash'] || item['hash'];
    if (hash) {
      return Model.library.getAlbumByTrackHash(item['@_hash']);
    }
    return null;
  }

  /**
   * @param index
   * @param array elements can be either playlist items or album track items
   * @param leftText
   * @param showDeleteButton whether to show the delete button (default: true)
   */
  static makeListItem(index, array, leftText="", showDeleteButton = true, hideDragIcon = false, dateKey = '', sameDatePrev = false, sameDateNext = false) {
    const item = array[index];
    const itemPrevious = (index > 0) ? array[index - 1] : null;
    const itemNext = (index < array.length - 1) ? array[index + 1] : null;
    const album = TrackListItemUtil.getAlbumForTrackDataItem(item);
    const albumPrevious = TrackListItemUtil.getAlbumForTrackDataItem(itemPrevious);
    const albumNext = TrackListItemUtil.getAlbumForTrackDataItem(itemNext);
    const isSameAsPrevious = (album && !albumPrevious) || (album && (album == albumPrevious));
    const isSameAsNext = (album && album == albumNext);
    let groupingClass = '';
    if (album) {
      groupingClass = !isSameAsNext ? 'groupLast' : 'groupMiddle';
    } else {
      if (!isSameAsPrevious && isSameAsNext) {
        groupingClass = 'groupFirst';
      } else if (isSameAsPrevious && !isSameAsNext) {
        groupingClass = 'groupLast';
      } else if (isSameAsPrevious && isSameAsNext) {
        groupingClass = 'groupMiddle';
      } else { // isSameAsPrevious && isSameAsNext
        groupingClass = 'groupSingle';
      }
    }
    const hash = item['@_hash'] || Model.library.getHashForPlaylistItem(item) || '';
    const seconds = parseFloat(item['@_length']);
    const durationText = seconds ? Util.durationText(seconds) : '';
    const durationEmptyClass = durationText ? '' : 'isEmpty';
    let s = '';
    let itemClasses = `${groupingClass}`;
    if (album) {
      itemClasses += ' albumTrack';
    }
    s += `<div class="trackItem ${itemClasses}" data-index="${index}" data-hash="${hash}">`;
    // timeline column before left / cover
    if (hideDragIcon) {
      // history item: render timeline marker and connector lines
      const hasMarker = (!sameDatePrev && !!leftText);
      s += `  <div class="timelineCol">`;
      s += `    <div class="timelineInner ${hasMarker ? 'hasMarker' : 'noMarker'}">`;
      s += `      <div class="line top visible"></div>`;
      if (!sameDatePrev && leftText) {
        s += `      <div class="marker visible"><span class="markerText">${leftText}</span></div>`;
      }
      s += `      <div class="line bottom visible"></div>`;
      s += `    </div>`;
      s += `  </div>`;
      s += `  <div class="left historyItemTime">`;
      s += `</div>`;
    } else {
      // playlist/search item: keep plain number (no circular marker)
      s += `  <div class="timelineCol-placeholder">`;
      s += `    <div class="timelineInner-placeholder">`;
      s += `      <div class="line top "></div>`;
      s += `      <div class="line bottom "></div>`;
      s += `    </div>`;
      s += `  </div>`;
      s += `  <div class="left">`;
      if (!hideDragIcon) {
        const isSingleTrackAlbum = album && (album != albumPrevious) && (album != albumNext);
        if (!isSingleTrackAlbum) {
          s += `<div class="iconButton dragHandleButton"></div>`;
        }
      }
      s += `<span class="trackItemNum">${leftText}</span>`;
      s += `</div>`;
    }
    const mainText = album 
        ? TrackListItemUtil.makeMainContents(item, album)
        : TrackListItemUtil.makeNonLibraryMainContents(item, album);
    s += `  <div class="main">${mainText}</div>`;
    s += `  <div class="trackItemDurationCol ${durationEmptyClass}"><span class="trackItemDuration">${durationText}</span></div>`;
    if (hash) {
      const isFavorite = MetaUtil.isTrackFavoriteFor(hash);
      const favoriteSelectedClass = isFavorite ? 'isSelected' : '';
      const numViews = MetaUtil.getNumViewsFor(hash);
      s += `<div class="trackItemMeta">`;
      s += `  <div class="numViews">${numViews || ''}</div>`;
      s += `  <div class="iconButton toggleButton favoriteButton ${favoriteSelectedClass}"><div class="favoriteIcon"></div></div>`;
      s += `</div>`;
    }
    if (showDeleteButton) {
      s += `  <div class="right"><div class="iconButton deleteButton"></div></div>`;
    }
    s += `</div>`;
    return $(s);
  }

  static makeNonLibraryHistoryItem(agoString, dateKey = '', sameDatePrev = false, sameDateNext = false) {
    const hasMarker = (!sameDatePrev && !!agoString);
    let s = `<div class="trackItem groupSingle">`;
    s += `  <div class="timelineCol">`;
    s += `    <div class="timelineInner ${hasMarker ? 'hasMarker' : 'noMarker'}">`;
    // Keep the timeline line continuous even for unknown/non-library items.
    // Otherwise the history "spine" appears to stop when older items can't be resolved.
    s += `      <div class="line top visible"></div>`;
    if (!sameDatePrev && agoString) {
      s += `      <div class="marker visible"><span class="markerText">${agoString}</span></div>`;
    }
    s += `      <div class="line bottom visible"></div>`;
    s += `    </div>`;
    s += `  </div>`;
    s += `  <div class="left historyItemTime"></div>`;
    s += `  <div class="main">Unknown track</div>`;
    s += `</div>`;
    return $(s);
  }

  /**
   * Returns html string contents for the `.main` section of the track list item:
   * Track name + duration text. Optionally, a new line with song-artist.
   */
  static makeMainContents(item) {

    const song = item['@_song'];
    let result = '';
    result += `<span class="trackText">${ song ? song : 'Track' }</span>`;

    // Album track items do not have the album's performer or composer properties (redundantly) populated.
    // Playlist track items have artist, and performer + composer (when exists),
    // even when they are the same as that of its album (when album exists)
    let songPerformer = item['@_performer'];
    let songArtist = item['@_artist'];
    let songComposer = item['@_composer'];
    if (item['@_uri']) {
      // Is playlist track, not album track
      const assocAlbum = Model.library.getAlbumByTrackUri(item['@_uri']);
      if (assocAlbum) {
        if (assocAlbum['@_artist'] && assocAlbum['@_artist'] == songArtist) {
          cl('artist is dupe, removing', songArtist);
          songArtist = null;
        }
        if (assocAlbum['@_performer'] && assocAlbum['@_performer'] == songPerformer) {
          cl('performer is dupe, removing', songPerformer);
          songPerformer= null;
        }
        if (assocAlbum['@_composer'] && assocAlbum['@_composer'] == songComposer) {
          cl('composer is dupe, removing', songComposer);
          songComposer= null;
        }
      }
    }
    let extraLines = '';
    if (songPerformer) {
      extraLines += `<div class='extraLine'><span class='caption'>Performer</span> <span class='extraValue'>${Util.formatMetaHtml(songPerformer)}</span></div>`;
    }
    if (songArtist) {
      extraLines += `<div class='extraLine'><span class='caption'>Artist</span> <span class='extraValue'>${songArtist}</span></div>`;
    }
    if (songComposer) {
      extraLines += `<div class='extraLine'><span class='caption'>Composer</span> <span class='extraValue'>${Util.formatMetaHtml(songComposer)}</span></div>`;
    }
    if (extraLines) {
      result += `<div class="extra">${extraLines}</div>`;
    }

    return result;
  }

  /**
   * Returns html string contents for the `.main` section of the track list item
   * for a non-library track: Artist, album, track, and duration.
   * (Rem, in this case, there is no album header, and the list item is not 'grouped').
   */
  static makeNonLibraryMainContents(item) {
    const artist = item['@_artist'] || item['@_album_artist'];
    const album = item['@_album'];
    const song = item['@_song'];

    let result = '';

    if (artist || album) {
      let s = '';
      if (artist) {
        s += artist;
      }
      if (album) {
        s += s ? `<br>${album}` : album;
      }
      result += `<div class="nonLibraryInfo">${s}</div>`;
    }

    result += `<span class="trackText">${song || 'Track'}</span>`;

    return result;
  }

  /**
   * Returns null if `item` is not from library or `item` is from same album as `itemPrevious`.
   */
  static makeAlbumHeaderIfNecessary(index, array, leftText = '', dateKey = '', sameDatePrev = false, sameDateNext = false, hideDragIcon = true) {

    const item = array[index];
    const album = TrackListItemUtil.getAlbumForTrackDataItem(item);
    if (!album) {
      return null;
    }
    const itemPrevious = (index > 0) ? array[index - 1] : null;
    const albumPrevious = itemPrevious ? TrackListItemUtil.getAlbumForTrackDataItem(itemPrevious) : null;
    if (album == albumPrevious) {
      return null;
    }

    const itemNext = (index < array.length - 1) ? array[index + 1] : null;
    const albumNext = itemNext ? TrackListItemUtil.getAlbumForTrackDataItem(itemNext) : null;
    const isSingleTrackAlbum = album != albumNext;

    const imgPath = DataUtil.getAlbumImageUrl(album);
    const albumText = album['@_album'];
    const artistText = album['@_artist'];
    if (!albumText && !artistText) {
      return null;
    }

    // render artist and album in separate blocks for styling
    let text = '';
    if (artistText) {
      text += `<div class="albumArtist">${artistText}</div>`;
    }
    if (albumText) {
      text += `<div class="albumTitle">${albumText}</div>`;
    }
    if (!text) {
      return null;
    }

    const statsText = AlbumUtil.makePlaylistAlbumStatsText(album);

    let s = '';
    s +=  `<div class="trackItem groupFirst trackItemAlbumHeader${isSingleTrackAlbum ? ' isSingleTrackAlbum' : ''}"${isSingleTrackAlbum ? ` data-index="${index}"` : ''}>`;
    // placeholder timeline column: show connector segments when adjacent items share same date
    s += `  <div class="timelineCol-placeholder">`;
    s += `    <div class="timelineInner-placeholder">`;
    s += `      <div class="line top ${sameDatePrev ? 'visible' : ''}"></div>`;
    s += `      <div class="line bottom ${sameDateNext ? 'visible' : ''}"></div>`;
    s += `    </div>`;
    s += `  </div>`;
    if (isSingleTrackAlbum && !hideDragIcon) {
      s += `  <div class="left"><div class="iconButton dragHandleButton"></div></div>`;
    }
    s +=    `<div class="albumLineButton" data-hash="${album['@_hash']}">`;
    s +=      `<div class="coverThumb">`;
    s +=        `<img src="${imgPath}" alt="">`;
    s +=        `<div class="coverFallback" aria-hidden="true"></div>`;
    s +=      `</div>`;
    s +=      `<div class="text">${text}</div>`;
    s +=    `</div>`;
    s +=    `<div class="statsText">${statsText}</div>`;
    s += `</div>`;
    const $el = $(s);
    const $img = $el.find('img');
    $img.on('error', () => {
      $el.addClass('isCoverMissing');
    });
    $img.on('load', () => {
      $el.removeClass('isCoverMissing');
    });
    return $el;
  }

  /**
   * Makes handler for listening to track meta events (two different ones).
   * Used for updating track list items' favorite button selectedness and track count.
   *
   * Example usage:
   *   const f = TrackListItemUtil.makeTrackMetaChangeHandler($myDiv);
   *   $(document).on('meta-track-favorite-changed meta-track-incremented', f);
   */
  static makeTrackMetaChangeHandler($listHolder) {
    const f = (e, hash) => {
      if (!hash) {
        cl('warning no hash');
        return;
      }
      const $els = $listHolder.find(`[data-hash="${hash}"]`); // brute force
      if ($els.length == 0) {
        return;
      }

      if (e.type == 'meta-track-favorite-changed') {
        const $favoriteButtons = $els.find('.favoriteButton');
        MetaUtil.isTrackFavoriteFor(hash)
            ? $favoriteButtons.addClass('isSelected')
            : $favoriteButtons.removeClass('isSelected');
      } else if (e.type == 'meta-track-incremented') {
        const $numViews = $els.find('.numViews');
        const value = MetaUtil.getNumViewsFor(hash);
        $numViews.text(value);
      }
    };
    return f;
  }
}

TrackListItemUtil.onAlbumButton = (e) => {
  const $el = $(e.currentTarget);
  const hash = $el.attr('data-hash');
  const album = Model.library.getAlbumByAlbumHash(hash);
  if (!album) {
    return;
  }
  $(document).trigger('track-album-button-click', album);
};

TrackListItemUtil.onFavoriteButtonClick = (event) => {
  event.stopPropagation();
  const $button = $(event.currentTarget);
  const $listItem = $button.parent().parent();
  const hash = $listItem.attr('data-hash');
  if (!hash) {
    cl('warning no hash data attr', $button);
    return;
  }
  const oldValue = MetaUtil.isTrackFavoriteFor(hash);
  const newValue = !oldValue;
  MetaUtil.setTrackFavoriteFor(hash, newValue);
};
