```markdown
# Changelog

## 1.0.0 — New UI design and enhanced browsing

- New UI design with a refreshed top bar, sidebar filter layout, and better mobile search flow.
- Improved library search and filters so the app is easier to browse.
- Search now matches artist, album, genre, track, record label, format and year.
- Use commas to combine search terms and year ranges like `1970-1980`, `1990-`, `-2000`.
- Sidebar filters now cover browse mode, format chips, genre tags, historical periods and record labels.
- Shift-click makes it easy to select multiple genres, periods or labels at once.
- Library view, search and sort work together: filters narrow results, search refines them, and sort controls result order.
- Web data is used for lyrics lookup and remote artist metadata import.
- Album view includes a folder-open button and a lyrics overlay for quick access.
- Favorite status can now be written into audio file tags.

## UI Improvements

### Playlist Panel
- Added trash icon for instant track deletion
- Implemented drag and drop reordering functionality
- Removed the three-dot context menu

### Player
- Enhanced progress bar to better indicate elapsed time
- Added subtle animation to indicate active playback status

### Library View
- Added advanced filter search functionality with the following options:
  - **Text search**: genre, artist, album, track
  - **Year filters**: `1970`, `1970-1980`, `1990-`, `-2000`
  - **Format filters**: `dsd`, `dsd64`, `dsd128`, `dsd256`, `dsd512`
  - **Sample rate filters**: `44.1`, `96`, `192`, `44100hz`, `44.1khz`
  - Use comma to perform AND searches

  **Examples:**
  - `rock, 1990-2000, 192` → Rock albums from 1990-2000 in PCM 192kHz format
  - `jazz, dsd, -1980` → Jazz albums in DSD formats released before 1980

- Changed upscaler settings icon for better clarity

### Settings View
- Added new option to customize accent color

### Album View
- Added play button before each track

### Search View
- Added new universal search tab
- Implemented search-as-you-type functionality

### Group By View
- Replaced individual collapse/expand submenus with a unified toolbar button

### Group By Year View
- Added quick year navigation minimap on the right side

### General
- Clicking "Library" in the header now scrolls to the top of the page
- Various minor UI refinements and simplifications

## March 6, 2026 — Layout / FOUC fixes

- Preload `css/main.css` in `www/index.html` to reduce flash-of-unstyled-content.
- Added guarded reflow and measurement helpers in `www/view-util.js` (`forceReflow`, `getRect`).
- Replaced direct layout-forcing calls with safe helpers in:
  - `www/progress-view.js`
  - `www/dropdown.js`
  - `www/app-util.js`
  - `www/context-menu.js`
  - `www/library-album-options-view.js`
  - `www/playlist-view.js`
  - `www/app.js`

These changes defer or retry layout reads until `window.load` when necessary, avoiding the
"Layout was forced before the page was fully loaded" console warning while preserving
immediate behavior in normal runtime.
```

