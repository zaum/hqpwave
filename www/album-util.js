import Values from './values.js';
import Util from './util.js';
import DataUtil from './data-util.js';
import Model from './model.js';
import ViewUtil from './view-util.js'
import MetaUtil from './meta-util.js'

/**
 *
 */
export default class AlbumUtil {

  /**
   * Returns array of track objects from album object.
   * @NonNull
   */
  static getTracksOf(album) {
    if (!album['LibraryFile']) {
      return [];
    }
    const value = album['LibraryFile'];
    return Array.isArray(value) ? value : [value];
  }

  static makeAlbumStatsText(album) {
    const duration = AlbumUtil.makeAlbumDurationText(AlbumUtil.getTracksOf(album));
    const fullDate = album['@_date'];
    const date = fullDate ? fullDate.substring(0, 4) : null;
    const bitrateText = AlbumUtil.getBitrateText(album);
    const filetypeText = AlbumUtil.getFiletypeText(album);
    const bitrateDisplayText = bitrateText ? `<span class="albumFormatText">${bitrateText}&nbsp;</span>` : '';
    const formatText = filetypeText ? `<span class="albumFormatText">${filetypeText}&nbsp;</span>` : '';

    let s = '';
    if (bitrateText || filetypeText) {
      let s2 = '';
      if (bitrateDisplayText) {
        s2 = bitrateDisplayText;
      }
      if (formatText) {
        s2 = s2 ? s2 + formatText : formatText;
      }
      s = s ? (s + ' • ' + s2) : s2;
    }
    if (duration) {
      s = s ? s + (' • ' + duration) : duration;
    }
    if (date) {
      s = s ? (s + ' • ' + date) : date;
    }
    return s;
  }

  /**
   *
   */
  static updateGenreButtons($holder, album) {
    $holder.empty();
    if (album['genres'].length == 0) {
      ViewUtil.setDisplayed($holder, false);
      return;
    }
    ViewUtil.setDisplayed($holder, 'flex');
    for (const genre of album['genres']) {
      const s = `<span class="genre-tag" data-value="${genre}">${genre}</span>`;
      const $button = $(s);
      $button.on('click tap', AlbumUtil.onGenreButtonClick);
      $holder.append($button);
    }
  }

  static onGenreButtonClick = (e) => {
    const value = $(e.currentTarget).attr('data-value');
    if (!value) {
      cl('warning no value');
      return;
    }
    $(document).trigger('album-genre-button', value);
  };

  static makePlaylistAlbumStatsText(album) {
    const bitrateText = AlbumUtil.getBitrateText(album);
    const filetypeText = AlbumUtil.getFiletypeText(album);
    let s = '';
    if (bitrateText) {
      s += bitrateText;
    }
    if (filetypeText) {
      s = s ? s + '<br>' + filetypeText : filetypeText;
    }
    return s;
  }

  /** Returns empty string on bad data. */
  static getBitrateText(album) {
    const rate = parseInt(album['@_rate']); // hertz
    const bits = parseInt(album['@_bits']);
    if (!(rate > 0) || !(bits > 0)) {
      return '';
    }

    let sampleRateText = '';
    let bitDepthText = '';

    // In library metadata, bits===1 is used for DSD.
    if (bits === 1) {
      sampleRateText = `${rate / 1000000} MHz`;
    } else {
      sampleRateText = `${rate / 1000} kHz`;
      bitDepthText = `${bits} bit`;
    }

    return bitDepthText ? `${sampleRateText} ${bitDepthText}` : sampleRateText;
  }

  /** Returns album total duration display text, or empty string if fail. */
  static makeAlbumDurationText(tracks) {
    if (!tracks || tracks.length == 0) {
      return '';
    }
    let albumSeconds = 0;
    for (let item of tracks) {
      const trackSeconds = parseFloat(item['@_length']);
      if (isNaN(trackSeconds)) {
        return ''; // unexpected; give up
      }
      albumSeconds += trackSeconds;
    }
    const result = Util.durationTextHoursMinutes(albumSeconds);
    return result;
  }

  static getFiletypeText(album) {
    const tracks = AlbumUtil.getTracksOf(album);
    if (!tracks) {
      return '';
    }
    // fwiw hqp appears to filter out 'outlier' music files from a given directory,
    // so this logic may not ever come into play.
    let lastGoodSuffix = null;
    for (const item of tracks) {
      const suffix = Util.getFileSuffix(item['@_name']);
      if (!suffix) {
        continue; // meh keep going
      }
      if (suffix != lastGoodSuffix) {
        if (!lastGoodSuffix) {
          lastGoodSuffix = suffix;
        } else {
          cl('multiple suffixes detected', suffix, 'vs', lastGoodSuffix);
          return null;
        }
      }
    }
    if (!lastGoodSuffix) {
      return null;
    }
    return lastGoodSuffix.toUpperCase();
  }
}
