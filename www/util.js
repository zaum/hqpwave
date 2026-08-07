import Service from './service.js'

/**
 * App-wide util functions.
 */
export default class Util {}

const XML_ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
};

/** 
 * Hooks up custom events off of document.
 * Doesn't support removing listener.
 * todo/nb: doesnt work correctly when target is not same object as where this fn is invoked from [?]
 */
Util.addAppListener = (context, eventName, callback) => {
	$(document).on(eventName, (e, ...rest) => callback.call(context, ...rest));
};

Util.durationText = (totalSeconds, ignoreSeconds=false) => {
	const totalMinutes = totalSeconds / 60;
	const hours = Math.floor(totalMinutes / 60);
	let displayMinutes = Math.floor(totalMinutes % 60);
	let displaySeconds = Math.floor(totalSeconds % 60);
	if (displaySeconds < 10) {
		displaySeconds = "0" + displaySeconds;
	}

	let result = '';
	if (hours) {
		// Add hours
		result += hours;
		if (displayMinutes < 10) {
			displayMinutes = "0" + displayMinutes;
		}
	}
	// Add minutes
	result += result ? (":" + displayMinutes) : displayMinutes;
	// Add seconds
	if (!ignoreSeconds) {
		result += ":" + displaySeconds;
	}
	return result;
};

/** Ex, "1h5m or 45m */
Util.durationTextHoursMinutes = (totalSeconds) => {
  "use strict";
  const hours = Math.floor(totalSeconds / 3600);
  const secondsRemainder = totalSeconds - (hours * 3600);
  const minutes = Math.round(secondsRemainder / 60);
  const result = hours ? `${hours}\u202Fh ${minutes}\u202Fm` : `${minutes}\u202Fm`;
  return result;
};

/**
 * Strips filename from an uri coming from hqplayer.
 * May not be complete.
 */
Util.stripFilenameFromPath = (path) => {
  if (!path) {
    return path;
  }
  const i1 = path.indexOf('/');
  const i2 = path.indexOf('\\');
  const separator = (i1 >= i2) ? '/' : '\\';
  const result = path.substring(0, path.lastIndexOf(separator));
  return result;
};

Util.getFilenameFromPath = (path) => {
  if (!path) {
    return path;
  }
  const i1 = path.indexOf('/');
  const i2 = path.indexOf('\\');
  const separator = (i1 >= i2) ? '/' : '\\';
  const result = path.substring(path.lastIndexOf(separator) + 1);
  return result;
};

/**
 * Because jQuery objects are 'array-like' but not actual Arrays.
 */
Util.jqueryObjectIndexOf = ($jqueryObject, element) => {
  for (let i = 0; i< $jqueryObject.length; i++) {
    if ($jqueryObject[i] === element) {
      return i;
    }
  }
  return -1;
};

/**
 * @param delimiter would be say, ", " for a typical comma situation
 */
Util.makeCasualDelimitedString = (array, delimiter) => {
  let s = '';
  for (let el of array) {
    if (el === null || el === undefined || el === '') {
      continue;
    }
    if (s.length > 0) {
      s = s + delimiter + el;
    } else {
      s = el;
    }
  }
  return s;
};

Util.makeCasualSecondsString = (ms) => {
  let sec = (ms / 1000);
  sec = (Math.round(sec * 100) / 100).toFixed(2);
  return sec + '\u202Fs';
};

Util.hasMatch = (arrayOfObjects, objectKey, value) => {
  for (let el of arrayOfObjects) {
    if (el[objectKey] === value) {
      return true;
    }
  }
  return false;
};

Util.makeHowLongAgoString = (ms) => {
  let min = (ms / (1000 * 60));
  if (min < 50) {
    return Math.round(min) + '\u202Fm';
  }
  let hr  = (ms / (1000 * 60 * 60));
  if (hr < 22) {
    return Math.round(hr) + '\u202Fh';
  }
  let day = (ms / (1000 * 60 * 60 * 24));
  if (day < 6.5) {
    return Math.round(day) + '\u202Fd';
  }
  let wk  = (ms / (1000 * 60 * 60 * 24 * 7));
  if (wk < 3.5) {
    return Math.round(wk) + '\u202Fw';
  }
  let mo  = (ms / (1000 * 60 * 60 * 24 * 30));
  if (mo < 12.5) {
    return Math.round(mo) + '\u202Fmo';
  }
  return '1y+';
};

// From https://medium.com/@nitinpatel_20236/
Util.shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * i);
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
};

Util.getFileSuffix = (filename) => {
  if (!filename) {
    return null;
  }
  const i = filename.lastIndexOf('.');
  if (i == -1) {
    return null;
  }
  const s = filename.substr(i + 1);
  return s;
};

/**
 * Forces track list item to be fully visible, aligned to bottom edge
 * in the album view and playlist view.
 *
 * But only if it's currently partially or wholly cropped at the bottom,
 * and only if the jump is not too large.
 *
 * Idea is that when the track advances forward, the newly selected item
 * should be made visible as needed, as a convenience.
 * Should only be called when last-selected-item is above `$listItem`.
 */
Util.autoScrollListItem = ($listItem, $holder, step=2) => {
  // Distance of list item's bottom edge from bottom edge of container.
  const getBottomEdgeDistance = () => {
    const listBottom = $holder.scrollTop() + $holder.outerHeight();
    const itemBottom = $listItem[0].offsetTop + $listItem.outerHeight();
    return (itemBottom - listBottom);
  };

  const maxDistance = $listItem.outerHeight() * 2;
  const delta = getBottomEdgeDistance($listItem);
  if (delta < 0 || delta > maxDistance) {
    return;
  }

  $(document).trigger('disable-user-input');
  let count = 100; // failsafe lol
  const f = () => {
    // Must be recalculated on every frame
    // (rather than doing a simple css property assignment)
    // bc of dynamic sizing of container due to topbar scroll effect (!)
    const delta = getBottomEdgeDistance($listItem);
    if (delta < 1.01 || count-- <= 0) {
      cancelAnimationFrame(id);
      $(document).trigger('enable-user-input');
      return;
    }
    const target = $holder.scrollTop() + step; // (delta * 0.35);
    $holder.scrollTop(target);
    id = requestAnimationFrame(f);
  };
  let id = requestAnimationFrame(f);
};

/**
 * Initiates browser file download.
 *
 * @param filename filename that will be pre-populated in browser "Save-as" dialog.
 * @param mimeType eg, "text/plain"
 * @param content
 */
Util.downloadFile = (filename, mimeType, content) => {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.setAttribute('download', filename);
  a.setAttribute('href', window.URL.createObjectURL(blob));
  a.click();
};

Util.decodeXmlEntities = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/&(amp|lt|gt|quot|apos);/g, (match, name) => XML_ENTITY_MAP[name] || match);
};

Util.safeDecodeUriComponent = (value) => {
  if (typeof value !== 'string' || !/%[0-9A-Fa-f]{2}/.test(value)) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return value;
  }
};

/**
 * Converts either a local path or a file:// URI into a comparable local path
 * using forward slashes and decoded XML/URI escapes when safe.
 */
Util.toComparableLocalPath = (value) => {
  let result = Util.decodeXmlEntities(value).trim();
  if (!result) {
    return '';
  }

  if (/^file:/i.test(result)) {
    result = result.replace(/^file:/i, '');
    result = Util.safeDecodeUriComponent(result);

    if (/^\/\/\/[a-zA-Z]:/.test(result)) {
      result = result.slice(3);
    } else if (/^\/\/[a-zA-Z]:/.test(result)) {
      result = result.slice(2);
    } else if (result.startsWith('///')) {
      result = result.slice(2);
    } else if (/^\/[a-zA-Z]:/.test(result)) {
      result = result.slice(1);
    }

    if (/^[a-zA-Z]\|/.test(result)) {
      result = result.replace(/^([a-zA-Z])\|/, '$1:');
    } else if (/^\/[a-zA-Z]\|/.test(result)) {
      result = result.replace(/^\/([a-zA-Z])\|/, '$1:');
    }
  }

  return result.replace(/\\/g, '/');
};

Util.encodeLocalPathForFileUri = (value) => {
  const path = Util.toComparableLocalPath(value);
  if (!path) {
    return '';
  }

  const isUnc = path.startsWith('//');
  const segments = path.split('/');
  return segments.map((segment, index) => {
    if (!segment) {
      return '';
    }
    if (/^[a-zA-Z]:$/.test(segment)) {
      return segment;
    }
    if (isUnc && index === 2) {
      return segment;
    }
    return encodeURIComponent(segment);
  }).join('/');
};

Util.makeFileUri = (value) => {
  const path = Util.toComparableLocalPath(value);
  if (!path) {
    return '';
  }

  const encodedPath = Util.encodeLocalPathForFileUri(path);
  if (path.startsWith('//')) {
    return `file:${encodedPath}`;
  }
  if (/^[a-zA-Z]:\//.test(path)) {
    // HQPlayer on Windows expects the legacy two-slash form:
    // file://I:/Music/Track.flac
    return `file://${encodedPath}`;
  }
  if (path.startsWith('/')) {
    return `file://${encodedPath}`;
  }
  return `file:///${encodedPath.replace(/^\/+/, '')}`;
};

Util.makeFileUriFromParts = (folderPath, filename) => {
  const folder = Util.toComparableLocalPath(folderPath).replace(/[\/]+$/, '');
  const file = Util.decodeXmlEntities(filename || '').replace(/^[\/\\]+/, '');
  if (!folder || !file) {
    return '';
  }
  return Util.makeFileUri(`${folder}/${file}`);
};

Util.areUriAndPathEquivalent = (uri, path) => {
  if (!uri && !path) {
    return true;
  }
  if (!uri || !path) {
    return false;
  }
  return (Util.toComparableLocalPath(uri) == Util.toComparableLocalPath(path));
};

// Pretty good test for touch devices
Util.isTouch =  !!("ontouchstart" in window) || window.navigator.msMaxTouchPoints > 0;

/** Escape plain text for safe HTML insertion. */
Util.escapeHtml = (str) => {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

/**
 * Formats a metadata value for insertion as HTML.
 * Parenthetical parts are removed from parentheses and wrapped in <em>..</em>.
 * Example: "John Doe (piano)" -> "John Doe <em>piano</em>"
 */
Util.formatMetaHtml = (str, enableParenthesisEmphasis = true) => {
  if (str === null || str === undefined) return '';
  const escaped = Util.escapeHtml(str);
  // Replace commas with two spaces, then optionally convert parenthetical groups
  // into italicized text (remove parentheses). Example when enabled:
  // "John Doe, (piano)" -> "John Doe  <em>piano</em>"
  let s = escaped.replace(/,\s*/g, '  ');
  if (enableParenthesisEmphasis) {
    s = s.replace(/\s*\(([^)]+)\)/g, ' <em>$1</em>');
  } else {
    // Keep the parenthetical text intact (preserve parentheses)
    s = s.replace(/\s*\(([^)]+)\)/g, ' ($1)');
  }
  return s;
};
