# Artist view — data sources and filtering

This document explains where the Artist view (`www/artist-view.js`) gets its data, how the backend assembles and stores that data, and the client-side filtering/fallback logic used when rendering the artist page.

## 1. Backend: sources and storage

- `server/sources.js`
  - Queries external services to build an `artist` object:
    - MusicBrainz: search artist and fetch releases (ws/2). Releases are limited to the first 15 for fast responses.
    - CoverArtArchive: fetches release (or release-group) thumbnails for release covers.
    - Wikipedia: fetches plaintext extract (summary), thumbnail and page URL.
    - Wikimedia Commons: fallback image search when no other images are available.
  - Produces an `artist` object with fields: `id`, `name`, `disambiguation`, `bio`, `wiki_url`, `discography` (array of {id, title, year, cover_url}), and `default_image_id`.
  - Builds an `images` list derived from wiki thumbnail and release cover URLs. Image IDs follow conventions (see below) and the images list is upserted via `db.addImagesBulk`.

- `server/db.js`
  - Stores `artists` and `images` tables. Exposes `upsertArtist`, `addImagesBulk`, `getArtistById`, `getArtistByName`.
  - `getArtistById(id)` returns the artist row and attaches `images = SELECT * FROM images WHERE artist_id = ?`.

- `server/artist-handler.js`
  - GET `/endpoints/artist?get&id=...` → returns artist JSON (from DB) including `discography` and `images`.
  - POST `/endpoints/artistImport?name=...` → triggers `sources.fetchAndStoreArtistByName` to import/persist metadata and images.
  - GET `/endpoints/artistImage?artist_id=...&image_id=...` → serves or redirects the requested image. If image URL is a local path `sendFile`, otherwise `response.redirect` to the remote URL. Handler supports synthetic release image IDs (e.g. `mbid-rel-<releaseId>`) and will redirect to the release `cover_url` when available.

## 2. Image ID conventions

- Wiki thumbnail: `${mbid}-wiki`
- Release cover: `${mbid}-rel-${release.id}`
- Commons fallback: `${mbid}-comm-<index>`

These IDs are stored in the `images` table and referenced by the frontend via the `artistImage` proxy endpoint.

## 3. Frontend: how `ArtistView` consumes and filters data

- Main file: `www/artist-view.js`.

- Loading flow (`loadArtist(artistId)`):
  1. `GET /endpoints/artist?get&id=...` — if DB has the artist, server returns `artist` JSON.
  2. If 404, frontend triggers `POST /endpoints/artistImport?name=...` (server imports data), then re-fetches the artist.

- Rendering (`renderArtist(artist)`):
  - Basic fields used directly from `artist`: `artist.name`, `artist.disambiguation`, `artist.bio`, `artist.wiki_url`.
  - Gallery images: built from `artist.images`, filtered by allowed sources (the code displays only certain sources like `wikipedia` and `commons`), and each image is shown via a proxy URL:
    `/endpoints/artistImage?artist_id=<mbid>&image_id=<image-id>`.
  - Discography rendering rules (per release):
    - If a release matches a local library album (via `Model.library.getAlbumByTitleAndArtist`), the release is marked `isLocal` and the cover is the library cover computed by `DataUtil.getAlbumImageUrl(album)`.
    - If not local and `release.cover_url` is present, the frontend uses the synthetic ID `${mbid}-rel-${release.id}` and requests `/endpoints/artistImage?...`.
    - If `release.cover_url` is missing, the frontend falls back to scanning `artist.images` for an image with id `${mbid}-rel-${release.id}` (this allows images saved at import time to still be used even if `cover_url` was absent in the release record).
  - Bio processing: `linkifyBio()` trims/limits the bio (uses `__SUMMARY_END__` or first paragraphs), removes short section headings, and linkifies other known artists found in the local library to prevent simple name-copy clutter.
  - UI flags: `Settings.showPlayButton` and `Settings.showFormatOverlay` toggle overlay elements and CSS classes.

## 4. Filtering & transformations

- Deduplication of image URLs is performed when `sources.js` builds the `images` list before calling `db.addImagesBulk`.
- Backend limits releases to the first 15 (fast imports). If you need more releases, increase that limit in `server/sources.js`.
- The frontend also performs matching logic to treat local albums specially (play button, format overlay, pointer behavior).

## 5. Troubleshooting checklist

- If a non-local release shows no cover in the UI:
  - Check `GET /endpoints/artist?name=ARTIST` — verify `discography[n].cover_url` is set or that `images` contains `${mbid}-rel-${release.id}`.
  - If `cover_url` is present in `discography` but images table lacks the corresponding entry, re-run import (`POST /endpoints/artistImport?name=ARTIST`) to refresh images.
  - Confirm `/endpoints/artistImage?artist_id=<mbid>&image_id=<image-id>` responds with a redirect (302) or file send.

- If images appear but are grayscale/transparent due to CSS, inspect `www/css/artist.css` for `.artistDiscItem.not-local` rules (opacity/hover behavior).

## 6. Quick commands

- Trigger import:
  ```bash
  curl -X POST "http://localhost:8000/endpoints/artistImport?name=ARTIST_NAME"
  ```
- Fetch stored artist JSON:
  ```bash
  curl "http://localhost:8000/endpoints/artist?name=ARTIST_NAME"
  ```
- Check an image redirect (example):
  ```bash
  curl -I "http://localhost:8000/endpoints/artistImage?artist_id=<id>&image_id=<image-id>"
  ```

## 7. Notes / next steps

- If you want more release coverage, raise the release limit in `server/sources.js` (and consider background importing for large artists).
- Consider persisting `cover_url` at import time (server already stores it in `discography`) and validating that `images` contain the expected synthetic IDs after `addImagesBulk`.

---

If you want, I can commit this file to the repo (`docs/artist-view-data.md`) — say "commit" to proceed, or "modify" to change the content first.
