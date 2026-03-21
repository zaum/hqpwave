/**
 * Acts as go-between between `server.js` and HQPlayer.
 * Gets called by `server.js` via `sendCommandToHqp()` and then calls back with a payload.
 * Talks to HQPlayer via TCP socket.
 */

const dgram = require('dgram');
const net = require("net");
const readline = require('readline');
const { XMLParser } = require('fast-xml-parser');

const log = require('./log');

const TROUBLESHOOTING_URL = 'https://github.com/zaum/hqpwave/blob/master/readme_enduser.md';
const UDP_ADDRESS = "239.192.0.199";
const PORT = 4321;
const DISCOVERY_RETRY_INTERVAL_MS = 1500;
const DISCOVERY_GIVE_UP_MS = 5 * 60 * 1000;
const XML_HEADER = `<?xml version="1.0" encoding="UTF-8"?>`;
const POSSIBLY_MULTICHUNK_STARTS = ['<LibraryGet', '<PlaylistGet', '<GetFilters'];
const POSSIBLY_MULTICHUNK_ENDS = ['</LibraryGet>', '</PlaylistGet>', '</GetFilters>'];
const XML_PARSER_OPTIONS = { ignoreAttributes : false };
const xmlParser = new XMLParser(XML_PARSER_OPTIONS);
// Fallback parser that doesn't process entities (avoids entity expansion limits)
const xmlParserNoEntities = new XMLParser(Object.assign({}, XML_PARSER_OPTIONS, { processEntities: false }));

let initCallback;
let timeoutId;
let discoveryStartedAt = 0;
let discoveryAttemptCount = 0;
let connectAttemptCount = 0;
let hasDiscoveryStatusLine = false;
let isExitKeypressActive = false;
let exitRequested = false;
let exitReadlineInterface;
let exitOnDataHandler;
let exitOnKeypressHandler;
let exitOnLineHandler;

/** UDP socket used for 'discovery' command. */
let discoSocket;
/** TCP socket which has a persistent connection to hqp. */
let socket;

/** The ip address of the HQPlayer socket server. */
let hqpIp;

let validHqpIps = [];
let validHqpHostnames = [];

let isFirstChunk = true;
let clientRequestXml; // The request data fro the client
let clientRequestAsJson; 
let responseCallback; // The callback to be invoked upon completion of the current 'command'
let normalBuffer = Buffer.alloc(0); // The buffered data which accumulates until complete, used for 'normal' responses
let isPossiblyMultiChunk;

const start = (callback) => {
  initCallback = callback;
  initDiscoverySocket();
};

const initDiscoverySocket = () => {
	if (discoSocket) {
		discoSocket.close();
	}
  log.x('creating udp socket');
	discoSocket = dgram.createSocket('udp4');
	
  discoSocket.on('error', () => {
    log.w(`udp socket error:\n${err.stack}\n`);
    discoSocket.close();
  });
  discoSocket.on('message', onDiscoSocketMessage);
  discoSocket.on('listening', onDiscoSocketListening);

	discoSocket.bind();
};

const onDiscoSocketListening = () => {
  log.x(`udp socket listening on ${discoSocket.address().address}:${discoSocket.address().port}`);
  discoSocket.setMulticastLoopback(true);
  log.x(`waiting for response from HQPlayer...`);
  enableStartupExitHotkey();
  discoveryStartedAt = Date.now();
  discoveryAttemptCount = 0;
  connectAttemptCount = 0;
  runDiscoveryAttempt();
};

const runDiscoveryAttempt = () => {
  discoveryAttemptCount++;
  sendUdpCommand(`<discover>hqplayer</discover>`);
  timeoutId = setTimeout(onDiscoveryTimeout, DISCOVERY_RETRY_INTERVAL_MS);
};

const writeDiscoveryStatus = (message) => {
  hasDiscoveryStatusLine = true;
  process.stdout.write(`\r\x1b[2K${message}`);
};

const clearDiscoveryStatus = () => {
  if (!hasDiscoveryStatusLine) {
    return;
  }
  process.stdout.write(`\r\x1b[2K`);
  hasDiscoveryStatusLine = false;
};

const onDiscoSocketMessage = (msg, rinfo) => {
  clearDiscoveryStatus();
  log.x(`udp socket received message from ${rinfo.address}:${rinfo.port}`);
  if (!msg.toString().includes('<discover')) {
    log.x(`  unrecognized message, ignoring:`, msg.toString().substr(0,30));
    return;
  }
  let json;
  try {
    json = xmlParser.parse(msg.toString().trim());
  } catch (error) {
    log.x(`ERROR: Couldn't parse udp data as xml`);
    log.x(msg.toString());
    log.x(error + '\n');
    return;
  }

  const o = json['discover'];
  if (!o) {
    return; // shdnthpn
  }
  if (o['@_result'] != 'OK') {
    log.x(`WARNING: Did not get expected result=OK`);
    return;
  }

  log.x('  ' + o['@_name']);

  if (validHqpIps.includes(rinfo.address)) {
    return;
  }
  validHqpIps.push(rinfo.address);
  validHqpHostnames.push(o['@_name']);
};

const onDiscoveryTimeout = () => {
  if (validHqpIps.length == 0) {
    const elapsedMs = Date.now() - discoveryStartedAt;
    if (elapsedMs >= DISCOVERY_GIVE_UP_MS) {
      clearDiscoveryStatus();
      printNoResponse();
      return;
    }
    const secondsElapsed = Math.floor(elapsedMs / 1000);
    const secondsRemaining = Math.ceil((DISCOVERY_GIVE_UP_MS - elapsedMs) / 1000);
    writeDiscoveryStatus(`HQPlayer retry #${discoveryAttemptCount + 1} | elapsed ${secondsElapsed}s | left ${secondsRemaining}s`);
    runDiscoveryAttempt();
    return;
  }
  if (validHqpIps.length > 1) {
    clearTimeout(timeoutId);
    clearDiscoveryStatus();
    disableExitKeypress();
    doSelectInstance();
    return;
  }

  clearTimeout(timeoutId);
  clearDiscoveryStatus();
  disableExitKeypress();
  hqpIp = validHqpIps[0];
  initSocket();
};

const printNoResponse = () => {
  clearTimeout(timeoutId);
  log.x(`--------------------------------`);
  log.x(`ERROR: No response from HQPlayer`);
  log.x(`Tried to discover HQPlayer for ${Math.round(DISCOVERY_GIVE_UP_MS / 1000)} seconds.`);
  log.x(`TIPS:`);
  log.x(`1. Make sure HQPlayer is currently running`);
  log.x(`2. Make sure HQPlayer's Settings dialog is not open.`);
  log.x(`3. Verify HQPlayer "Allow control from network" button is enabled.`);
  log.x(`4. For more troubleshooting info, see ${TROUBLESHOOTING_URL}.\n`);
  exitOnKeypress();
};

const doSelectInstance = () => {
  log.x('\nSelect which instance of HQPlayer to connect to:');
  const limit = Math.min(validHqpHostnames.length, 9);
  for (let i = 0; i < limit; i++) {
    log.x(`  [${i+1}] ${validHqpIps[i]} (${validHqpHostnames[i]})`);
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', onSelectInstanceKeypress)
};

const onSelectInstanceKeypress = (buffer) => {
  const key = buffer.toString();
  const charCode = key.charCodeAt(0);
  if (charCode == 3) { // control-c
    process.exit();
  }
  const index = charCode - 49;
  if (index < 0 || index >= validHqpIps.length || index > 9) {
    return;
  }

  process.stdin.off('data', onSelectInstanceKeypress);
  process.stdin.setRawMode(false);

  hqpIp = validHqpIps[index];
  initSocket();
};

const sendUdpCommand = (message) => {
  message = XML_HEADER + message;
	discoSocket.send(message, PORT, UDP_ADDRESS, (error) => {
    if (error) {
      log.x(`ERROR sending udp message`);
      log.x(error + '\n');
      exitOnKeypress();
    }
  });
	// fyi, reference implementation also does this, but results in an error for me
	// socket.send(message, 4321, "ff08::c7", onError);
};

const initSocket = () => {
  connectAttemptCount++;
  log.x(`connecting to tcp socket ${hqpIp}:${PORT}`);
  // Note, could also create connection using hostname instead of IP.
  // IP has proven to be more reliable when reconnecting windows hqpwv server to mac hqplayer, fwiw.
  socket = net.createConnection(PORT, hqpIp, () => {
    log.x('tcp socket connected');  // rem, still need to wait for 'ready'
  });
  socket.on("error", onSocketError);
  socket.on("end", onSocketEnd);
  socket.on("data", onData);
  socket.on("ready", () => {
    log.x('tcp socket ready');
    disableExitKeypress();
    if (initCallback) {
      initCallback(hqpIp);
      initCallback = null;
      // init finished.
    }
  });
};

/**
 * This will get called when hqp is not running
 * and also when settings is open (ECONNREFUSED).
 */
const onSocketError = (error) => {
  log.w('socket error:', error.message);
  if (responseCallback) {
    doCallback({error: "socket_error"});
  }

  if (initCallback) {
    const elapsedMs = Date.now() - discoveryStartedAt;
    if (elapsedMs >= DISCOVERY_GIVE_UP_MS) {
      reset();
      clearDiscoveryStatus();
      printNoResponse();
      return;
    }
    const secondsElapsed = Math.floor(elapsedMs / 1000);
    const secondsRemaining = Math.ceil((DISCOVERY_GIVE_UP_MS - elapsedMs) / 1000);
    writeDiscoveryStatus(`HQPlayer connect retry #${connectAttemptCount + 1} | elapsed ${secondsElapsed}s | left ${secondsRemaining}s`);
    reset();
    setTimeout(initSocket, 2000);
    return;
  }

  reset();
  // Try to reconnect
  setTimeout(initSocket, 2000);
};

const onSocketEnd = () => {
  // This would only ever get initiated by hqp.
  // FYI, hqp will end the socket if it receives bad xml sometimes.
  log.w('socket ended');
  if (responseCallback) {
    doCallback({ error: "socket_end" });
  }
  reset();
  initSocket();
}

// -------------------------------------------------------------------

const isBusy = () => {
  return !!clientRequestXml;
};

const sendCommandToHqp = (xml, callback) => {
  if (!socket) {
    callback({ error: "not_connected"});
    clearValues();
    return;
  }
  if (clientRequestXml) {
    // Should not be possible unless there is a logic error in
    // proxy.js or server-command-handler.js
    callback({ error: 'proxy_is_busy' });
    clearValues();
    return;
  }

  clientRequestXml = xml;
  responseCallback = callback;
  try {
    clientRequestAsJson = xmlParser.parse(clientRequestXml);
  } catch (error) {
    doCallback({ error: "request_xml_invalid" });
    // Note too that if hqp receives an unrecognized xml command, it will close the socket.
    return;
  }

  // log.x('sending to hqp:', xml.substr(0, 80));
  socket.write(XML_HEADER + clientRequestXml);
};

// ---

const onData = (data) => {
  // log.x(`received ${data.length} bytes`);

  const dataAsString = data.toString();

  if (!clientRequestXml) {
    // hqp is sending data while no 'command' is pending.
    log.w(`received data unprompted: ${dataAsString.substr(0, 40)}`);
    return;
  }


  if (isFirstChunk) {
    // log.x('is first chunk');
    isFirstChunk = false;

    if (!dataAsString.startsWith("<?xml")) {
      // some HQPlayer responses omit the XML header; try parsing anyway
      log.w('response missing XML header; attempting parse anyway');
      // continue without returning
    }
    if (dataAsString.includes(`result="Error"`)) {
      // Hpq sends this if the command is unrecognized.
      // But also if the command is 'rejected' (eg, doing <Next> at the end of the playlist).
      // This makes it too ambiguous to be useful without extra case-by-case parsing.
      // So, do nothing.

      // doCallback({ error: "hqp_unknown_command" });
      // log.x(dataAsString.substr(0,80))
      // return;
    }

    for (const item of POSSIBLY_MULTICHUNK_STARTS) {
      if (clientRequestXml.includes(item)) {
        isPossiblyMultiChunk = true;
        break;
      }
    }

    processFirstChunk(data, dataAsString);
  } else {
    processNextChunk(data, dataAsString);
  }
};

// ---

const processFirstChunk = (data, dataAsString) => {
  // log.x(`is first normal chunk`);
  normalBuffer = data;
  finishNormalIfPossible(dataAsString, true);
}

const processNextChunk = (data, dataAsString) => {
  normalBuffer = Buffer.concat([normalBuffer, data]); // todo expensive? wd buffer stream be more efficient?
  // log.x(`is subsequent normal chunk, buffer len ${normalBuffer.length}`);
  finishNormalIfPossible(dataAsString, false);
}

const finishNormalIfPossible = (dataAsString, isFirstChunk) => {

  let firstChunkJson;
  if (isFirstChunk) {
    try {
      firstChunkJson = xmlParser.parse(dataAsString.trim());
    } catch (e) { }
  }

  let isComplete;
  if (firstChunkJson) {
    isComplete = true;
  } else {
    if (isPossiblyMultiChunk) {
      for (const item of POSSIBLY_MULTICHUNK_ENDS) {
        if (dataAsString.includes(item)) {
          isComplete = true;
          break;
        }
      }
    } else {
      log.w('non-possibly-multichunk response did not parse, finishing anyway');
      isComplete = true;
    }
  }
  if (!isComplete) {
    return;
  }

  let resultJson;
  if (firstChunkJson) {
    resultJson = firstChunkJson;
    } else {
    const bufferAsString = normalBuffer.toString();
    const trimmed = bufferAsString.trim();
    try {
      resultJson = xmlParser.parse(trimmed);
    } catch (error) {
      // If entity expansion limit triggered, retry with entity processing disabled
      const msg = error && error.message ? error.message : String(error);
      if (msg.includes('Entity expansion limit')) {
        try {
          resultJson = xmlParserNoEntities.parse(trimmed);
        } catch (errNe) {
          log.w('XML parse failed even after disabling entity processing:', msg);
          log.w('raw response:', trimmed);
          resultJson = { error: "hqp_xml_invalid" };
        }
      } else {
        // Try a couple of other fallbacks: prepend XML header, or wrap in a root element
        try {
          resultJson = xmlParser.parse(XML_HEADER + trimmed);
        } catch (err2) {
          try {
            const wrapped = xmlParser.parse(`<root>${trimmed}</root>`);
            if (wrapped && wrapped.root) {
              const keys = Object.keys(wrapped.root);
              if (keys.length === 1) {
                resultJson = { [keys[0]]: wrapped.root[keys[0]] };
              } else {
                resultJson = wrapped;
              }
            } else {
              resultJson = { error: "hqp_xml_invalid" };
            }
          } catch (err3) {
            log.w('XML parse failed for response:', trimmed);
            log.w('parse error:', msg);
            resultJson = { error: "hqp_xml_invalid" };
          }
        }
      }
    }
  }

  resultJson = postProcessJson(resultJson);

  doCallback(resultJson);
};

const postProcessJson = (json) => {
  // If library data, remove any albums with zero elements
  // Occurs with m3u8 (we're not supporting this). Also seen on WavPack w/o metadata.
  if (json['LibraryGet']) {
    return postProcessLibrary(json)
  }

  return json
};

/**
 * Do any filtering, etc.
 */
const postProcessLibrary = (json) => {
  return json;
};

const doCallback = (json) => {
  if (json.error) {
    log.w('sending error:', json.error, clientRequestXml.substr(0, 40));
  }
  const callback = responseCallback;
  clearValues();
  callback(json);
};

// ---

const clearValues = () => {
  isFirstChunk = true;
  clientRequestXml = null;
  clientRequestAsJson = null;
  responseCallback = null;
  normalBuffer = Buffer.alloc(0);
  isPossiblyMultiChunk = false;
}

const reset = () => {
  clearValues();
  if (socket) {
    socket.destroy();
    socket = null;
  }
};

const exitOnKeypress = () => {
  if (isExitKeypressActive) {
    return;
  }
  isExitKeypressActive = true;

  log.x('Press any key to exit');

  const requestExit = () => {
    if (exitRequested) {
      return;
    }
    exitRequested = true;

    try {
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(false);
      }
    } catch (error) { }

    if (exitReadlineInterface) {
      try {
        exitReadlineInterface.close();
      } catch (error) { }
      exitReadlineInterface = null;
    }

    process.exit(1);
  };

  try {
    readline.emitKeypressEvents(process.stdin);
  } catch (error) {
    // no-op fallback to data event below
  }

  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try {
      process.stdin.setRawMode(true);
    } catch (error) {
      // no-op fallback to non-raw mode
    }
  }

  process.stdin.resume();
  exitOnKeypressHandler = requestExit;
  exitOnDataHandler = requestExit;
  process.stdin.once('keypress', exitOnKeypressHandler);
  process.stdin.once('data', exitOnDataHandler);

  if (!exitReadlineInterface) {
    try {
      exitReadlineInterface = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
      });
      exitOnLineHandler = requestExit;
      exitReadlineInterface.once('line', exitOnLineHandler);
    } catch (error) {
      // no-op
    }
  }
};

const disableExitKeypress = () => {
  if (!isExitKeypressActive) {
    return;
  }

  if (exitOnKeypressHandler) {
    process.stdin.off('keypress', exitOnKeypressHandler);
    exitOnKeypressHandler = null;
  }
  if (exitOnDataHandler) {
    process.stdin.off('data', exitOnDataHandler);
    exitOnDataHandler = null;
  }
  if (exitReadlineInterface && exitOnLineHandler) {
    exitReadlineInterface.off('line', exitOnLineHandler);
    exitOnLineHandler = null;
  }

  if (exitReadlineInterface) {
    try {
      exitReadlineInterface.close();
    } catch (error) { }
    exitReadlineInterface = null;
  }

  try {
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
  } catch (error) { }

  isExitKeypressActive = false;
};

const enableStartupExitHotkey = () => {
  exitOnKeypress();
};

module.exports = {
  isBusy: isBusy,
  sendCommandToHqp: sendCommandToHqp,
  start: start
};
