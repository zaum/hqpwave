/**
 * Server mechanics for metadata layer or smth.
 */
const log = require('./log');
const meta = require('./meta');

const { safeJson, safeStatusJson, safeSend } = require('./response-util');

const doGet = (request, response) => {

  // Prevent caching of metadata responses
  response.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  response.set('Pragma', 'no-cache');
  response.set('Expires', '0');

  if (request.query['info'] !== undefined) {
    safeJson(response, {
      'isEnabled': meta.getIsEnabled(),
      'mainFilepath': meta.getFilepath()
    });
    return;
  }

  if (!meta.getIsEnabled()) {
    safeJson(response, { error: 'meta_disabled' });
    return;
  }

  // ---
  // 'accessor' methods

  if (request.query['getMain'] !== undefined) {
    response.send(meta.getData());
    return;
  }

  if (request.query['getDownload'] !== undefined) {
    response.setHeader('Content-Type', 'text/json');
    response.setHeader('Content-disposition', 'attachment;filename=hqpwv-metadata.json');
    safeSend(response, meta.getData());
    return;
  }

  // ---
  // 'mutator' methods

  const hash = request.query['hash'];
  const value = request.query['value'];

  if (request.query['updateTrackFavorite'] !== undefined) {
    if (!hash || !value) {
      safeStatusJson(response, 400, { error: 'missing_required_sub_param' });
      return;
    }
    const writeFile = (request.query['writeFile'] === 'true');
    const result = meta.updateTrackFavorite(hash, value, writeFile);
    safeJson(response, { result: result });
    return;
  }

  if (request.query['updateAlbumFavorite'] !== undefined) {
    if (!hash || !value) {
      safeStatusJson(response, 400, { error: 'missing_required_sub_param' });
      return;
    }
    const writeFile = (request.query['writeFile'] === 'true');
    const result = meta.updateAlbumFavorite(hash, value, writeFile);
    safeJson(response, { result: result });
    return;
  }

  if (request.query['incrementTrackViews'] !== undefined) {
    if (!hash) {
      safeStatusJson(response, 400, { error: 'missing_required_sub_param' });
      return;
    }
    const result = meta.incrementTrackViews(hash);
    safeJson(response, { result: result });
    return;
  }

  if (request.query['updateTrackViews'] !== undefined) {
    if (!hash || !value) {
      safeStatusJson(response, 400, { error: 'missing_required_sub_param' });
      return;
    }
    const result = meta.updateTrackViews(hash, value);
    safeJson(response, { result: result });
    return;
  }

  if (request.query['clearHistory'] !== undefined) {
    meta.clearHistory();
    safeJson(response, { success: true });
    return;
  }

  if (request.query['deletePlaylist'] !== undefined) {
    const name = request.query['name'];
    const index = request.query['index'];
    if (!name || isNaN(index)) {
      safeStatusJson(response, 400, { error: 'bad_param' });
      return;
    }
    const result = meta.deletePlaylist(name, index);
    safeJson(response, { result: result });
    return;
  }

  safeStatusJson(response, 400, { error: 'missing_required_param' });
};

const doPost = (request, response) => {
  if (request.query['addPlaylist'] != undefined) {
    const o = request.body;
    const uriKey = 'uris[]'; // weird `body-parser` thing
    if (o[uriKey]) {
      o['uris'] = o[uriKey];
      delete o[uriKey];
    }
    let result = meta.addPlaylist(request.body);
    safeJson(response, { result: result });
    return;
  }

  if (request.query['clear'] !== undefined) {
    meta.clearData();
    safeJson(response, { success: true });
    return;
  }

  safeStatusJson(response, 400, { error: 'missing_required_param' });
};

module.exports = {
  doGet: doGet,
  doPost: doPost
};
