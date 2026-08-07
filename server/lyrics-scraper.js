const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const trackPathIndex = require('./track-path-index');

const UA = 'HQPWV/0.1 (https://github.com/zaum/hqpwave)';

const LYRICS_DIR_NAME = '.hqpwv-lyrics';
const LYRICS_SUFFIX = '.lyrics.txt';
const RATE_LIMIT_MS = 1100;
let lastFetchTime = 0;

const normalizeQuery = (s) => {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/feat\s+\S+/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
};

const httpGetText = (url, cb, redirects = 0) => {
  if (redirects > 5) return cb(new Error('too_many_redirects'));
  try {
    const opts = new URL(url);
    const protocol = opts.protocol === 'http:' ? http : https;
    let settled = false;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      cb(err, result);
    };
    const req = protocol.request(opts, {
      method: 'GET',
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/json' },
      timeout: 8000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        res.resume();
        return httpGetText(next, finish, redirects + 1);
      }
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          finish(new Error('HTTP error ' + res.statusCode), null);
          return;
        }
        finish(null, data);
      });
    });
    req.on('timeout', () => { req.destroy(); finish(new Error('timeout')); });
    req.on('error', (e) => finish(e));
    req.end();
  } catch (e) {
    cb(e);
  }
};

const rateLimitedFetch = (url, cb, redirects) => {
  const now = Date.now();
  const delay = Math.max(0, RATE_LIMIT_MS - (now - lastFetchTime));
  if (delay > 0) {
    setTimeout(() => {
      lastFetchTime = Date.now();
      httpGetText(url, cb, redirects);
    }, delay);
  } else {
    lastFetchTime = now;
    httpGetText(url, cb, redirects);
  }
};

const fetchFromLyricsOvh = (artist, title, cb) => {
  const url = 'https://api.lyrics.ovh/v1/' + encodeURIComponent(artist) + '/' + encodeURIComponent(title);
  rateLimitedFetch(url, (err, data) => {
    if (err) return cb(err);
    try {
      const parsed = JSON.parse(data);
      if (parsed && parsed.lyrics && parsed.lyrics.trim()) {
        return cb(null, parsed.lyrics.trim());
      }
      cb(new Error('no_lyrics'));
    } catch (e) {
      cb(e);
    }
  });
};

const fetchFromGenius = (artist, title, cb) => {
  const query = encodeURIComponent(artist + ' ' + title);
  const url = 'https://genius.com/api/search/song?q=' + query + '&per_page=3';
  rateLimitedFetch(url, (err, data) => {
    if (err) return cb(err);
    try {
      const parsed = JSON.parse(data);
      const hits = parsed && parsed.response && parsed.response.sections;
      if (!hits || !hits.length) return cb(new Error('no_results'));
      for (const section of hits) {
        const songHits = section.hits || [];
        for (const hit of songHits) {
          const result = hit && hit.result;
          if (!result || !result.url) continue;
          const resultArtist = (result.artist_names || '').toLowerCase();
          const resultTitle = (result.title || '').toLowerCase();
          const normArtist = normalizeQuery(artist);
          const normTitle = normalizeQuery(title);
          const normResultArtist = normalizeQuery(resultArtist);
          const normResultTitle = normalizeQuery(resultTitle);
          const artistMatch = normResultArtist.includes(normArtist) || normArtist.includes(normResultArtist);
          const titleMatch = normResultTitle.includes(normTitle) || normTitle.includes(normResultTitle);
          if (artistMatch && titleMatch) {
            return fetchGeniusLyricsPage(result.url, cb);
          }
        }
      }
      cb(new Error('no_match'));
    } catch (e) {
      cb(e);
    }
  });
};

const cleanLyricsText = (raw) => {
  let text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');

  const bracketIdx = text.search(/[[{]/);
  if (bracketIdx !== -1) {
    text = text.slice(bracketIdx);
  }

  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\d+\s*Contributors?\s*$/i.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .trim()
    .replace(/^[[{][^\]}]*[\]}]\s*$/gm, '\n$&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const extractContainerContent = (html, startIdx) => {
  let depth = 1;
  let i = startIdx;
  while (depth > 0 && i < html.length) {
    if (html[i] === '<') {
      if (html.slice(i, i+4) === '<div' && (html[i+4] === ' ' || html[i+4] === '>' || html[i+4] === '\n' || html[i+4] === '\r' || html[i+4] === '\t')) {
        depth++;
        i += 4;
      } else if (html.slice(i, i+6) === '</div>') {
        depth--;
        i += 6;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return html.slice(startIdx, depth === 0 ? i - 6 : i);
};

const fetchGeniusLyricsPage = (pageUrl, cb) => {
  rateLimitedFetch(pageUrl, (err, html) => {
    if (err) return cb(err);
    try {
      const containerStartRe = /<div[^>]*data-lyrics-container\s*=\s*"true"[^>]*>/gi;
      let parts = [];
      let startMatch;
      while ((startMatch = containerStartRe.exec(html)) !== null) {
        const content = extractContainerContent(html, startMatch.index + startMatch[0].length);
        if (content) parts.push(content);
      }
      if (!parts.length) return cb(new Error('no_lyrics_container'));
      let lyrics = cleanLyricsText(parts.join('\n'));
      if (lyrics && lyrics.length > 20) return cb(null, lyrics);
      cb(new Error('empty_lyrics'));
    } catch (e) {
      cb(e);
    }
  });
};

const getLyricsFilePath = (trackHash) => {
  const filePath = trackPathIndex.getTrackPath(trackHash);
  if (!filePath) return null;
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  return path.join(dir, baseName + LYRICS_SUFFIX);
};

const getLyricsDirPath = (trackHash) => {
  const filePath = trackPathIndex.getTrackPath(trackHash);
  if (!filePath) return null;
  const dir = path.dirname(filePath);
  return path.join(dir, LYRICS_DIR_NAME);
};

const getLyricsFilePathAlt = (trackHash) => {
  const filePath = trackPathIndex.getTrackPath(trackHash);
  if (!filePath) return null;
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const lyricsDir = path.join(dir, LYRICS_DIR_NAME);
  return path.join(lyricsDir, baseName + LYRICS_SUFFIX);
};

const readLyricsFile = (trackHash) => {
  const fp = getLyricsFilePath(trackHash);
  if (fp && fs.existsSync(fp)) {
    try { return fs.readFileSync(fp, 'utf8'); } catch (e) { return null; }
  }
  const fp2 = getLyricsFilePathAlt(trackHash);
  if (fp2 && fs.existsSync(fp2)) {
    try { return fs.readFileSync(fp2, 'utf8'); } catch (e) { return null; }
  }
  return null;
};

const writeLyricsFile = (trackHash, lyricsText) => {
  const fp = getLyricsFilePath(trackHash);
  if (!fp) {
    console.warn('[lyrics] writeLyricsFile failed: no file path for hash ' + trackHash);
    return false;
  }
  try {
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fp, lyricsText, 'utf8');
    console.log('[lyrics] lyrics written to ' + fp + ' (' + lyricsText.length + ' chars)');
    return true;
  } catch (e) {
    console.error('[lyrics] writeLyricsFile error for hash ' + trackHash + ': ' + e.message);
    return false;
  }
};

const deleteLyricsFile = (trackHash) => {
  let deleted = false;
  const fp = getLyricsFilePath(trackHash);
  if (fp && fs.existsSync(fp)) {
    try { fs.unlinkSync(fp); deleted = true; } catch (e) { console.error('[lyrics] deleteLyricsFile error: ' + e.message); }
  }
  const fp2 = getLyricsFilePathAlt(trackHash);
  if (fp2 && fs.existsSync(fp2)) {
    try { fs.unlinkSync(fp2); deleted = true; } catch (e) { console.error('[lyrics] deleteLyricsFileAlt error: ' + e.message); }
  }
  if (deleted) {
    console.log('[lyrics] deleted lyrics files for hash ' + trackHash);
  } else {
    console.warn('[lyrics] deleteLyricsFile: no files found for hash ' + trackHash);
  }
  return deleted;
};

const fetchLyrics = (artist, title, cb) => {
  const normArtist = normalizeQuery(artist);
  const normTitle = normalizeQuery(title);
  if (!normArtist || !normTitle) {
    return cb(new Error('missing_query_params'));
  }

  const sources = [
    (next) => fetchFromLyricsOvh(artist, title, next),
    (next) => fetchFromGenius(artist, title, next)
  ];

  let sourceIndex = 0;
  const tryNext = (err, lyrics) => {
    if (lyrics) return cb(null, lyrics);
    sourceIndex++;
    if (sourceIndex >= sources.length) {
      return cb(err || new Error('no_lyrics'));
    }
    sources[sourceIndex](tryNext);
  };
  sources[0](tryNext);
};

module.exports = {
  fetchLyrics,
  getLyricsFilePath,
  getLyricsFilePathAlt,
  readLyricsFile,
  writeLyricsFile,
  deleteLyricsFile
};
