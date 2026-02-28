import Values from './values.js';
import Commands from './commands.js';
import Model from './model.js';

/**
 * Manages service calls to the 'native' endpoint.
 */
class Native {

  isHiddenImageUrl(imageUrl) {
    if (!imageUrl) {
      return false;
    }
    try {
      const url = new URL(imageUrl, window.location.origin);
      const rawPath = url.searchParams.get('path') || url.pathname || '';
      const decodedPath = decodeURIComponent(rawPath);
      const normalizedPath = decodedPath.replace(/\\/g, '/');
      const segments = normalizedPath.split('/').filter(Boolean);
      return segments.some((segment) => segment.startsWith('.'));
    } catch (e) {
      return false;
    }
  }

  /**
   * @param instanceId is sent to endpoint to track page instances connecting to the service
   * @param callback argument expected to be ip address, else null
   */
  getInfo(instanceId, callback) {
    const url = `${Values.NATIVE_ENDPOINT}?info&id=${instanceId}`;
    $.ajax({
      url: url,
      error: (e) => { cl(e); callback(null); },
      success: (data, textStatus, jqXHR) => { callback(data); }
    });
  }

  openFolder(path, callback) {
    const encodedPath = encodeURIComponent(path || '');
    const url = `${Values.NATIVE_ENDPOINT}?openFolder=1&path=${encodedPath}`;
    $.ajax({
      url: url,
      error: (e) => { cl(e); callback && callback({ error: 'request_failed' }); },
      success: (data) => { callback && callback(data); }
    });
  }

  getAlbumImages(path, callback) {
    const encodedPath = encodeURIComponent(path || '');
    const url = `${Values.NATIVE_ENDPOINT}?albumImages=1&path=${encodedPath}`;
    $.ajax({
      url: url,
      error: (e) => { cl(e); callback && callback({ error: 'request_failed', images: [] }); },
      success: (data) => {
        const result = data || { images: [] };
        if (!Array.isArray(result.images)) {
          result.images = [];
        }
        result.images = result.images.filter((imageUrl) => !this.isHiddenImageUrl(imageUrl));
        callback && callback(result);
      }
    });
  }
}

export default new Native();