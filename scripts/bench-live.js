/**
 * Live server benchmark wrapper. Starts the hqpwv server as a child
 * process, timestamps key log lines related to library post-processing,
 * and reports elapsed time from process start.
 *
 * Usage: node scripts/bench-live.js [tag]
 *   tag is printed in the output so you can tell PRE vs POST runs apart.
 *
 * The wrapper waits until it sees the "label extraction finished" (or
 * "favorite sync") line, or a timeout (90s), then kills the server.
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const TAG = process.argv[2] || 'POST';
const TIMEOUT_MS = 180000;
const PORT = process.env.HQPWV_PORT || 8000;

const startTime = Date.now();

function ts() {
  return ((Date.now() - startTime) / 1000).toFixed(2) + 's';
}

const markers = {
  'track path index built': 'buildIndex done',
  'favorite sync from audio files': 'favorite sync done',
  'label extraction finished': 'label extraction done',
  'init - async calls': 'app init done',
  'Loading playlist': 'playlist loaded'
};

const child = spawn('node', ['server.js'], {
  cwd: SERVER_DIR,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env
});

let done = false;
let triggered = false;
let favoriteSyncDone = false;
let labelExtractionDone = false;

function triggerLibraryGet() {
  if (triggered) return;
  triggered = true;
  const url = 'http://127.0.0.1:' + PORT + '/endpoints/command?xml=' + encodeURIComponent('<LibraryGet pictures="0" />');
  console.log('[' + TAG + '] ' + ts() + '  >>> triggering LibraryGet');
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => body += c);
    res.on('end', () => {
      console.log('[' + TAG + '] ' + ts() + '  <<< LibraryGet response ' + res.statusCode + ' (' + body.length + ' bytes)');
    });
  }).on('error', (e) => {
    console.log('[' + TAG + '] trigger error: ' + e.message);
  });
}

function handleLine(line) {
  const txt = line.toString();
  for (const key in markers) {
    if (txt.indexOf(key) !== -1) {
      console.log('[' + TAG + '] ' + ts() + '  ' + markers[key] + '  | ' + txt.trim().substring(0, 120));
    }
  }
  // Once the webserver is ready, trigger the LibraryGet command.
  if (txt.indexOf('webserver is ready') !== -1) {
    setTimeout(triggerLibraryGet, 500);
  }
  // Track each async phase independently.
  if (txt.indexOf('favorite sync from audio files') !== -1) {
    favoriteSyncDone = true;
  }
  if (txt.indexOf('label extraction finished') !== -1) {
    labelExtractionDone = true;
  }
  // Stop only when BOTH async phases have reported (or on timeout).
  if (favoriteSyncDone && labelExtractionDone) {
    if (!done) {
      done = true;
      console.log('[' + TAG + '] ' + ts() + '  *** both phases complete, stopping server ***');
      setTimeout(() => {
        try { child.kill('SIGTERM'); } catch (e) {}
        process.exit(0);
      }, 1500);
    }
  }
}

child.stdout.on('data', (d) => {
  const lines = d.toString().split('\n');
  for (const l of lines) {
    if (l.trim().length > 0) handleLine(l);
  }
});
child.stderr.on('data', (d) => {
  const lines = d.toString().split('\n');
  for (const l of lines) {
    if (l.trim().length > 0) handleLine(l);
  }
});

child.on('exit', (code) => {
  console.log('[' + TAG + '] server exited with code ' + code);
  process.exit(0);
});

console.log('[' + TAG + '] starting server, measuring from ' + new Date().toISOString());

setTimeout(() => {
  console.log('[' + TAG + '] TIMEOUT after ' + (TIMEOUT_MS / 1000) + 's, stopping');
  try { child.kill('SIGTERM'); } catch (e) {}
  process.exit(0);
}, TIMEOUT_MS);

