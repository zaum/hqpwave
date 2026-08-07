const path = require('path');

/**
 * Normalize a file path coming from HQPlayer's library XML into a
 * local filesystem path. Shared by track-path-index and label-cache to
 * avoid divergent normalization logic.
 */
function normalizeFilePath(rawPath) {
  let p = rawPath || '';
  try { p = decodeURIComponent(p); } catch (e) {}
  p = p.trim().replace(/^file:\/+/i, '');
  if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
  if (process.platform === 'win32' && /^[a-zA-Z]\|/.test(p)) p = p.replace(/^([a-zA-Z])\|/, '$1:');
  return path.normalize(p);
}

module.exports = { normalizeFilePath };
