# Release Notes - hqpwv

## What's New in This Version

This release introduces several new features and improvements to the library view and navigation.

---

## New Features

### 1. Timeline Minimap
A new visual navigation feature for the year-grouped library view that allows quick navigation through your album collection.

**Features:**
- Visual timeline showing year range (first to last year)
- Draggable dot indicator showing current scroll position
- Click anywhere on the minimap to jump to that position
- Click on year labels (top/bottom) to scroll to specific years
- Touch support for mobile devices
- Mouse drag support for the position indicator

**Files changed:**
-  - Minimap rendering and interaction logic
-  - Minimap visual styles
-  - Minimap HTML container
-  - Minimap data integration

### 2. Click to Scroll to Top
Added functionality to scroll to the top of the library when clicking on the library header text.

**Files changed:**
-  - Scroll to top functionality
-  - Event handler
-  - Clickable title styles

---

## Improvements

### UI/UX Improvements
- Responsive design improvements for mobile devices (480px breakpoint)
- Better header padding and sizing
- Search container repositioning on mobile
- Top bar height adjustment for mobile viewports
- Clickable title with hover effect

### Code Improvements
- Touch support for timeline dot dragging
- Enhanced scroll position calculations
- Better event handling with stopPropagation

---

## Technical Details

**Total changes from original fork:**
- 4 commits added
- 7 files changed
- +328 lines added
- -130 lines removed

**Commits:**
1. minimap initial (b9b2f4a)
2. minimap (f3bab7e)
3. minimap bugfix (e3510bf)
4. click on library text scrolls to top (dc07a1c)

---

## Version Information

- **Original version:** cfa6735 (initial commit)
- **Current version:** dc07a1c
- **Date:** 2026-02-21
