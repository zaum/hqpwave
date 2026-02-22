# Changelog - Changes from Original Fork

## Overview
This document describes the changes made to the original hqpwave repository.

**Original repository:** https://github.com/zaum/hqpwave.git  
**Base commit:** cfa6735 (origin/main - initial commit)  
**Current HEAD:** dc07a1c

---

## Changes Summary

### Total changes: 4 commits, 7 files changed (+328, -130 lines)

---

## Commits

### 1. Click on library text scrolls to top (dc07a1c)
**Date:** 2026-02-21

Added functionality to scroll to the top when clicking on the library text/header.

**Files changed:**
- www/app.js - Added scroll-to-top functionality
- www/css/main.css - CSS adjustments
- www/library-view.js - Added event handler

---

### 2. Minimap bugfix (e3510bf)
**Date:** 2026-02-21

Bug fixes for the minimap feature introduced in previous commits.

**Files changed:**
- www/app.js - Bug fixes and improvements

---

### 3. Minimap (f3bab7e)
**Date:** 2026-02-21

Major update to the minimap functionality with enhanced visualization and interaction.

**Files changed:**
- www/app.js - Extended minimap implementation
- www/css/main.css - New minimap styles
- www/index.html - Minimap container elements
- www/library-albums-list.js - Minimap data integration

---

### 4. Minimap initial (b9b2f4a)
**Date:** 2026-02-21

Initial implementation of the minimap feature - a visual overview of the album library.

**Files changed:**
- www/css/main.css - Initial minimap styles
- www/library-album-options-view.js - Minimap toggle option
- www/top-bar-util.js - Minimap initialization

---

## Feature Summary

### New Features
- **Minimap**: A new visual navigation feature that provides an overview of the album library. Users can quickly navigate through large libraries by interacting with the minimap.
- **Click to scroll**: Clicking on the library header text now scrolls to the top of the library view.

### Improvements
- Enhanced library navigation with visual minimap
- Better user interaction with scroll-to-top functionality

---

## Statistics

| Metric | Value |
|--------|-------|
| Commits added | 4 |
| Files changed | 7 |
| Lines added | +328 |
| Lines removed | -130 |
| Net change | +198 lines |

---

## Version Information

- **Original fork version:** cfa6735 (initial commit)
- **Current version:** dc07a1c (with minimap and scroll improvements)
