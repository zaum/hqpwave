const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'artists.db');

let db = null;

// Cached prepared statements
let selectArtistByIdStmt;
let selectArtistByNameStmt;
let upsertArtistStmt;
let updateDefaultImageStmt;
let insertImageStmt;
let selectImagesByArtistStmt;

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const init = () => {
  ensureDir(DB_DIR);
  db = new Database(DB_PATH);

  // Performance/pragmas: enable WAL and reasonable synchronous/cache settings
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -2000');
  } catch (e) {
    console.warn('[db] pragma failed', e);
  }

  db.exec(`CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT,
    disambiguation TEXT,
    bio TEXT,
    wiki_url TEXT,
    discography TEXT,
    default_image_id TEXT,
    updated_at INTEGER
  )`);

  // Automatic migrations (safe no-op if column exists)
  const tryAlter = (sql) => { try { db.exec(sql); } catch (e) { /* ignore if column exists */ } };
  tryAlter(`ALTER TABLE artists ADD COLUMN disambiguation TEXT`);
  tryAlter(`ALTER TABLE artists ADD COLUMN bio TEXT`);
  tryAlter(`ALTER TABLE artists ADD COLUMN wiki_url TEXT`);
  tryAlter(`ALTER TABLE artists ADD COLUMN discography TEXT`);
  tryAlter(`ALTER TABLE artists ADD COLUMN default_image_id TEXT`);
  tryAlter(`ALTER TABLE artists ADD COLUMN updated_at INTEGER`);

  db.exec(`CREATE TABLE IF NOT EXISTS images (
    id TEXT,
    artist_id TEXT,
    url TEXT,
    source TEXT,
    width INTEGER,
    height INTEGER,
    thumbnail_url TEXT,
    license TEXT,
    PRIMARY KEY (id, artist_id)
  )
  `);

  tryAlter(`ALTER TABLE images ADD COLUMN source TEXT`);
  tryAlter(`ALTER TABLE images ADD COLUMN width INTEGER`);
  tryAlter(`ALTER TABLE images ADD COLUMN height INTEGER`);
  tryAlter(`ALTER TABLE images ADD COLUMN thumbnail_url TEXT`);
  tryAlter(`ALTER TABLE images ADD COLUMN license TEXT`);

  // Prepare & cache statements
  selectArtistByIdStmt = db.prepare('SELECT * FROM artists WHERE id = ?');
  selectArtistByNameStmt = db.prepare('SELECT * FROM artists WHERE name = ?');
  upsertArtistStmt = db.prepare(`INSERT OR REPLACE INTO artists(id, name, disambiguation, bio, wiki_url, discography, default_image_id, updated_at)
      VALUES(?,?,?,?,?,?,?,?)`);
  updateDefaultImageStmt = db.prepare('UPDATE artists SET default_image_id = ?, updated_at = ? WHERE id = ?');
  insertImageStmt = db.prepare(`INSERT OR REPLACE INTO images(id, artist_id, url, source, width, height, thumbnail_url, license)
      VALUES(?,?,?,?,?,?,?,?)`);
  selectImagesByArtistStmt = db.prepare('SELECT * FROM images WHERE artist_id = ?');
};

const close = (cb) => {
  if (db) {
    db.close();
    if (cb) cb();
  }
};

const getArtistById = (id, cb) => {
  if (!db) return cb(new Error('db_not_initialized'));
  try {
    const row = selectArtistByIdStmt.get(id);
    if (!row) return cb(null, null);
    try { row.discography = row.discography ? JSON.parse(row.discography) : []; } catch (e) { row.discography = []; }
    row.images = selectImagesByArtistStmt.all(id);
    cb(null, row);
  } catch (err) { cb(err); }
};

const getArtistByName = (name, cb) => {
  if (!db) return cb(new Error('db_not_initialized'));
  try {
    const row = selectArtistByNameStmt.get(name);
    if (!row) return cb(null, null);
    try { row.discography = row.discography ? JSON.parse(row.discography) : []; } catch (e) { row.discography = []; }
    row.images = selectImagesByArtistStmt.all(row.id);
    cb(null, row);
  } catch (err) { cb(err); }
};

const upsertArtist = (artist, cb) => {
  if (!db) return cb(new Error('db_not_initialized'));
  try {
    const now = Date.now();
    const discog = JSON.stringify(artist.discography || []);
    upsertArtistStmt.run(artist.id, artist.name || '', artist.disambiguation || '', artist.bio || '',
           artist.wiki_url || null, discog, artist.default_image_id || null, artist.updated_at || now);
    cb(null);
  } catch (err) {
    console.error('[db] upsertArtist error:', err);
    cb(err);
  }
};

const setDefaultImage = (artistId, imageId, cb) => {
  if (!db) return cb(new Error('db_not_initialized'));
  try {
    const now = Date.now();
    const result = updateDefaultImageStmt.run(imageId, now, artistId);
    cb(null, result.changes);
  } catch (err) { cb(err); }
};

// keep single-image API for compatibility
const addImage = (artistId, image, cb) => {
  if (!db) return cb(new Error('db_not_initialized'));
  try {
    insertImageStmt.run(image.id, artistId, image.url, image.source || '', image.width || null,
           image.height || null, image.thumbnail_url || null, image.license || null);
    cb(null);
  } catch (err) { cb(err); }
};

// bulk insert using a transaction for much higher throughput
const addImagesBulk = (artistId, images, cb) => {
  if (!db) return cb(new Error('db_not_initialized'));
  try {
    const insertMany = db.transaction((artistIdInner, imgs) => {
      // Clear existing images first
      db.prepare('DELETE FROM images WHERE artist_id = ?').run(artistIdInner);
      for (const image of imgs) {
        insertImageStmt.run(
          image.id,
          artistIdInner,
          image.url,
          image.source || '',
          image.width || null,
          image.height || null,
          image.thumbnail_url || null,
          image.license || null
        );
      }
    });
    insertMany(artistId, images);
    cb(null);
  } catch (err) { cb(err); }
};

module.exports = { init, close, getArtistById, getArtistByName, upsertArtist, setDefaultImage, addImage, addImagesBulk };