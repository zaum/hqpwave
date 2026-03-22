/**
 * Server mechanics for playlist api.
 */
const log = require('./log');
const playlists = require('./playlists');

const { safeJson, safeStatusJson, safeSend } = require('./response-util');

const doGet = (request, response) => {

  if (request.query['getPlaylists'] !== undefined) {
    response.send(playlists.getPlaylists());
    return;
  }
  if (request.query['deletePlaylist'] !== undefined) {
    const filename = request.query.name;
    if (!filename) {
      safeStatusJson(response, 400, { error: 'missing_name_param' });
      return;
    }
    const isSuccess = playlists.deletePlaylist(filename);
    if (!isSuccess) {
      safeStatusJson(response, 400, { error: 'delete_failed' });
    } else {
      safeSend(response, 'OK');
    }
    return;
  }

  safeStatusJson(response, 400, { error: 'missing_required_param' });
};

const doPost = (request, response) => {
  if (request.query['savePlaylist'] != undefined) {
    let filename = request.query.name;
    if (!filename) {
      safeStatusJson(response, 400, { error: 'missing_name' });
      return;
    }
    if (!request.body || !request.body.data || request.body.data.length == 0) {
      safeStatusJson(response, 400, { error: 'missing_contents' });
      return;
    }
    const isSuccess = playlists.savePlaylist(filename, request.body.data);
    if (!isSuccess) {
      safeStatusJson(response, 400, { error: 'failed' });
      return;
    }

    const list = playlists.getPlaylists();
    safeJson(response, { result: list });
    return;
  }

  safeStatusJson(response, 400, { error: 'missing_required_param' });
};

module.exports = {
  doGet: doGet,
  doPost: doPost
};
