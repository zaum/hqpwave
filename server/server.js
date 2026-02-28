/**
 * Server entrypoint.
 * Plain js.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const bodyParser = require("body-parser");
const app = express();
const ip = require('ip');

const log = require('./log');
const packageJson = require('./../package.json');
const proxy = require('./proxy');
const meta = require('./meta');
const commandHandler = require('./server-command-handler');
const metaHandler = require('./server-meta-handler');
const playlistHandler = require('./server-playlist-handler');
const playlists = require('./playlists');

const APP_FILENAME = `hqpwv`;
const WEBPAGE_DIR = path.join( __dirname, './../www' );
const DEFAULT_PORT = 8000;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

let port;
let server;
let hqpIp;

const normalizeRequestedPath = (inputPath) => {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  let pathToOpen = inputPath;
  try {
    pathToOpen = decodeURIComponent(pathToOpen);
  } catch (e) {
    // keep raw if it was not URI-encoded
  }
  pathToOpen = pathToOpen.trim();
  pathToOpen = pathToOpen.replace(/^file:\/+/i, '');
  if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(pathToOpen)) {
    pathToOpen = pathToOpen.slice(1);
  }
  if (process.platform === 'win32' && /^[a-zA-Z]\|/.test(pathToOpen)) {
    pathToOpen = pathToOpen.replace(/^([a-zA-Z])\|/, '$1:');
  }
  return path.normalize(pathToOpen);
};

const isImageFilename = (filename) => {
  const ext = path.extname(filename || '').toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
};

const isHiddenName = (name) => {
  return !!name && name.startsWith('.');
};

const hasHiddenPathSegment = (inputPath) => {
  if (!inputPath) {
    return false;
  }
  const normalizedPath = inputPath.replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);
  return segments.some((segment) => segment.startsWith('.'));
};

const collectAlbumImagesRecursive = (folderPath, rootPath) => {
  let images = [];
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    if (isHiddenName(entry.name)) {
      continue;
    }

    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      images = images.concat(collectAlbumImagesRecursive(fullPath, rootPath));
      continue;
    }
    if (!entry.isFile() || !isImageFilename(entry.name)) {
      continue;
    }
    const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
    images.push({ relPath, fullPath });
  }

  return images;
};

// ---

if (__dirname.includes('/lee/')) {
  log.setLevel(log.LEVEL_VERBOSE);
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(WEBPAGE_DIR));

/**
 * 'commands'
 * Get proxied to HQPlayer.
 */
app.get('/endpoints/command', (request, response) => {
  commandHandler.go(request, response);
});

/**
 * 'native'
 */
app.get('/endpoints/native', (request, response) => {

  if (request.query.info !== undefined) {
    response.send({
      hqplayer_ip_address: hqpIp,
      server_ip_address: ip.address(),
      hqpwv_version: packageJson.version
    });
    return;
  }

  if (request.query.openFolder !== undefined) {
    const userAgent = (request.get('user-agent') || '').toLowerCase();
    const isMobileUa = /android|iphone|ipad|ipod|mobile|windows phone|blackberry/.test(userAgent);
    if (isMobileUa) {
      response.status(403).json({ error: 'desktop_only' });
      return;
    }

    const inputPath = request.query.path;
    if (!inputPath || typeof inputPath !== 'string') {
      response.status(400).json({ error: 'bad_param_data' });
      return;
    }

    let pathToOpen = normalizeRequestedPath(inputPath);

    try {
      if (!fs.existsSync(pathToOpen)) {
        response.status(404).json({ error: 'path_not_found' });
        return;
      }

      const stat = fs.statSync(pathToOpen);
      if (stat.isFile()) {
        pathToOpen = path.dirname(pathToOpen);
      }

      let command;
      let args;
      if (process.platform === 'win32') {
        command = 'explorer';
        args = [pathToOpen];
      } else if (process.platform === 'darwin') {
        command = 'open';
        args = [pathToOpen];
      } else {
        command = 'xdg-open';
        args = [pathToOpen];
      }

      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      response.send({ ok: true });
      return;
    } catch (error) {
      response.status(500).json({ error: 'open_failed' });
      return;
    }
  }

  if (request.query.albumImages !== undefined) {
    const inputPath = request.query.path;
    if (!inputPath || typeof inputPath !== 'string') {
      response.status(400).json({ error: 'bad_param_data', images: [] });
      return;
    }

    try {
      let folderPath = normalizeRequestedPath(inputPath);
      if (!fs.existsSync(folderPath)) {
        response.status(404).json({ error: 'path_not_found', images: [] });
        return;
      }

      const stat = fs.statSync(folderPath);
      if (stat.isFile()) {
        folderPath = path.dirname(folderPath);
      }

      const images = collectAlbumImagesRecursive(folderPath, folderPath)
        .sort((a, b) => a.relPath.localeCompare(b.relPath, undefined, { numeric: true, sensitivity: 'base' }))
        .map((item) => `/endpoints/native?albumImage=1&path=${encodeURIComponent(item.fullPath)}`);

      response.json({ images });
      return;
    } catch (error) {
      response.status(500).json({ error: 'read_failed', images: [] });
      return;
    }
  }

  if (request.query.albumImage !== undefined) {
    const inputPath = request.query.path;
    if (!inputPath || typeof inputPath !== 'string') {
      response.status(400).json({ error: 'bad_param_data' });
      return;
    }

    try {
      const imagePath = normalizeRequestedPath(inputPath);
      if (hasHiddenPathSegment(imagePath)) {
        response.status(400).json({ error: 'bad_param_data' });
        return;
      }
      if (!fs.existsSync(imagePath)) {
        response.status(404).json({ error: 'path_not_found' });
        return;
      }

      const stat = fs.statSync(imagePath);
      if (!stat.isFile() || !isImageFilename(imagePath)) {
        response.status(400).json({ error: 'bad_param_data' });
        return;
      }

      response.sendFile(path.resolve(imagePath));
      return;
    } catch (error) {
      response.status(500).json({ error: 'read_failed' });
      return;
    }
  }

  // No recognized param
  response.status(400).json( {error: 'bad_param_data'} );
});

/**
 * 'meta'
 */
app.get('/endpoints/meta', (request, response) => {
  metaHandler.doGet(request, response);
});

/**
 * 'playlist'
 */
app.get('/endpoints/playlist', (request, response) => {
  playlistHandler.doGet(request, response);
});

app.post('/endpoints/playlist', (request, response) => {
  playlistHandler.doPost(request, response);
});

// ---

const onProxyReady = (ip) => {
  hqpIp = ip;
  // Start server
  server = app.listen(port, onSuccess).on('error', onError);

  // Init meta
  let isSuccess = meta.init();
  if (!isSuccess) {
    log.x('warning meta init failed, hqpwv metadata disabled')
  } else {
    log.x('metadata ready');
  }

  // Init custom playlists
  isSuccess = playlists.init();
  if (!isSuccess ) {
    log.x('warning custom playlists init failed, will be disabled')
  } else {
    log.x('custom playlists ready');
  }
};

// ---

const onError = (e) => {
  if (e.code == 'EADDRINUSE') {
    log.x(`ERROR: Port ${port} is in use.`);
    log.x(`Try using a different port:`);
    log.x(`     ${APP_FILENAME} -port [PORTNUMBER]\n`);
    showPromptAndExit();
  } else {
    log.e(`server caught error: ${e.code}`);
  }
};

const onSuccess = () => {
  log.x(`webserver is ready on port ${port}`);
  const ipAddress = ip.address();
  const urlText = ipAddress
      ? `http://${ipAddress}:${port}`
      : `the IP address of this machine on port ${port}`; // yek
  log.x(`\n----------------------------------------------------`);
  log.x(`READY.`);
  log.x(`Now browse to ${urlText}`);
  log.x(`from a device on your local network.`);
  log.x(`Please keep this process running.`);
  log.x(`----------------------------------------------------`);
};

/**
 * Expects something like `port 8000`, `-port 8000`, `--port 8000`, or simply `8000`
 */
getArgPort = () => {
  const value = getArgValue('port');
  const intValue = parseInt(value);
  return (!isNaN(intValue) && intValue > 0) ? intValue : DEFAULT_PORT;
};

/**
 * Returns the argument that follows the specified argument.
 * @param key should not have leading dashes
 */
getArgValue = (key) => {
  for (let i = 2; i < process.argv.length - 1; i++) {
    const arg = process.argv[i];
    if (arg == key || arg == ('-' + key) || arg == ('--' + key)) {
      const value = process.argv[i + 1];
      return value;
    }
  }
  return null;
};

isArgHelp = () => {
  const arg1 = process.argv[2];
  if (!arg1) {
    return false;
  }
  return (arg1.startsWith('help') || arg1.startsWith('-help') || arg1.startsWith('--help'));
};

printHelp = () => {
  log.x('Optional arguments:');
  log.x('--port [portnumber]');
  log.x('    Port to run the webserver on (default is ' + DEFAULT_PORT + ')');
  log.x('--hqpip [ip_address]');
  log.x('    IP address of the machine running HQPlayer.');
  log.x('    Only necessary if running multiple instances');
  log.x('    of HQPlayer on the network.');
};

const showPromptAndExit = () => {
  log.x('\nPress any key to exit');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', process.exit.bind(process, 1))
};

// Save meta json before exiting
process.on( "SIGINT", function() {
  if (meta.getIsDirty()) {
    meta.saveFile();
  }
  log.x('done');
  process.exit();
});

// ---

log.x(`\n----------------------------------------------------`);
log.x('HQPWV Server', packageJson.version);
log.x('Project page: ' + packageJson.homepage);
if (isArgHelp()) {
  log.x(`----------------------------------------------------\n`);
  printHelp();
  return;
} else {
  log.x('Use --help for available options.');
  log.x(`----------------------------------------------------\n`);
}

port = getArgPort();
proxy.start(onProxyReady);
