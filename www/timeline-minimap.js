import ViewUtil from './view-util.js';

/**
 * Initialize a timeline minimap instance bound to the DOM container.
 * Returns an object: { update(years), dispose() }
 */
export function initTimelineMinimap(containerId = 'timelineMinimapContainer') {
  const container = document.getElementById(containerId);
  if (!container) {
    return { update: () => {}, dispose: () => {} };
  }

  const minimap = container.querySelector('#timelineMinimap');
  if (!minimap) {
    return { update: () => {}, dispose: () => {} };
  }

  let years = null;
  let dot = null;
  let lineEl = null;

  // Cached layout values, recomputed only on resize, not on every scroll.
  let cachedScrollRange = 0;
  let cachedContainerHeight = 0;
  let rafPending = false;
  let pendingScrollContainer = null;

  function clearMinimap() {
    while (minimap.firstChild) minimap.removeChild(minimap.firstChild);
  }

  function createLabel(text, style) {
    const el = document.createElement('div');
    el.className = 'minimapYearLabel';
    if (style === 'top') el.style.top = '0';
    if (style === 'bottom') el.style.bottom = '0';
    el.textContent = text;
    el.addEventListener('click', (e) => { e.stopPropagation(); scrollToYear(parseInt(text, 10)); });
    return el;
  }

  function scrollToYear(year) {
    const containerEl = document.getElementById('libraryView');
    if (!containerEl) return;
    const labels = Array.from(document.querySelectorAll('.libraryGroupLabel.year'));
    const found = labels.find(l => l.textContent && l.textContent.indexOf(String(year)) !== -1);
    if (found) {
      containerEl.scrollTop = found.offsetTop;
    }
  }

  function onContainerClick(e) {
    const scrollContainer = document.getElementById('libraryView');
    if (!scrollContainer) return;
    const rect = minimap.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    const margin = 50;
    const dotSize = 14;
    const availableHeight = Math.max(1, height - dotSize - (margin * 2));
    const adjustedY = y - margin;
    const percent = Math.max(0, Math.min(1, adjustedY / availableHeight));
    const scrollHeight = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    scrollContainer.scrollTop = percent * scrollHeight;
  }

  function recacheLayout() {
    const scrollContainer = document.getElementById('libraryView');
    if (!scrollContainer || !minimap) return;
    cachedScrollRange = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    const rect = minimap.getBoundingClientRect();
    cachedContainerHeight = rect.height;
  }

  function updateDotPosition() {
    if (!years || !dot || !minimap) return;
    const scrollContainer = document.getElementById('libraryView');
    if (!scrollContainer) return;
    // Recompute cached values lazily if stale (e.g. first call or after resize).
    if (cachedContainerHeight === 0) {
      recacheLayout();
    }
    const scrollHeight = cachedScrollRange;
    const containerHeight = cachedContainerHeight;
    const scrollProgress = scrollHeight > 0 ? scrollContainer.scrollTop / scrollHeight : 0;
    const dotSize = 14;
    const margin = 50;
    const availableHeight = Math.max(1, containerHeight - dotSize - (margin * 2));
    const dotTop = margin + (scrollProgress * availableHeight);
    dot.style.top = Math.max(margin, Math.min(containerHeight - dotSize - margin, dotTop)) + 'px';
  }

  function scheduleUpdateDotPosition() {
    const scrollContainer = document.getElementById('libraryView');
    if (!scrollContainer) return;
    if (rafPending) return;
    rafPending = true;
    pendingScrollContainer = scrollContainer;
    requestAnimationFrame(() => {
      rafPending = false;
      updateDotPosition();
    });
  }

  function makeDotDraggable() {
    if (!dot) return;
    let isDragging = false;
    let startPercent = 0;
    let startClientY = 0;

    function startDrag(clientY) {
      isDragging = true;
      startClientY = clientY;
      const scrollContainer = document.getElementById('libraryView');
      if (scrollContainer) {
        const scrollHeight = scrollContainer.scrollHeight - scrollContainer.clientHeight;
        startPercent = scrollHeight > 0 ? scrollContainer.scrollTop / scrollHeight : 0;
      }
    }

    function moveDrag(clientY) {
      if (!isDragging) return;
      const scrollContainer = document.getElementById('libraryView');
      if (!scrollContainer) return;
      const rect = minimap.getBoundingClientRect();
      const containerHeight = rect.height;
      const dotSize = 14;
      const margin = 50;
      const availableHeight = Math.max(1, containerHeight - dotSize - (margin * 2));
      const deltaY = clientY - startClientY;
      const deltaPercent = deltaY / availableHeight;
      let newPercent = startPercent + deltaPercent;
      newPercent = Math.max(0, Math.min(1, newPercent));
      const scrollHeight = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      scrollContainer.scrollTop = newPercent * scrollHeight;
    }

    function endDrag() { isDragging = false; }

    dot.addEventListener('mousedown', (e) => { startDrag(e.clientY); e.preventDefault(); e.stopPropagation(); });
    document.addEventListener('mousemove', (e) => moveDrag(e.clientY));
    document.addEventListener('mouseup', () => endDrag());
    dot.addEventListener('touchstart', (e) => { startDrag(e.touches[0].clientY); e.preventDefault(); e.stopPropagation(); });
    document.addEventListener('touchmove', (e) => { moveDrag(e.touches[0].clientY); e.preventDefault(); });
    document.addEventListener('touchend', () => endDrag());
  }

  function update(newYears) {
    years = newYears;
    clearMinimap();
    if (!years || years.length === 0) return;
    const firstYear = years[0];
    const lastYear = years[years.length - 1];
    minimap.appendChild(createLabel(firstYear, 'top'));
    lineEl = document.createElement('div');
    lineEl.className = 'minimapLine';
    minimap.appendChild(lineEl);
    minimap.appendChild(createLabel(lastYear, 'bottom'));
    dot = document.createElement('div');
    dot.className = 'minimapDot';
    minimap.appendChild(dot);
    container.removeEventListener('click', onContainerClick);
    container.addEventListener('click', onContainerClick);
    const scrollContainer = document.getElementById('libraryView');
    if (scrollContainer) {
      scrollContainer.removeEventListener('scroll', scheduleUpdateDotPosition);
      scrollContainer.addEventListener('scroll', scheduleUpdateDotPosition);
      recacheLayout();
      updateDotPosition();
    }
    makeDotDraggable();
  }

  function dispose() {
    container.removeEventListener('click', onContainerClick);
    const scrollContainer = document.getElementById('libraryView');
    if (scrollContainer) scrollContainer.removeEventListener('scroll', scheduleUpdateDotPosition);
    clearMinimap();
  }

  function onResize() {
    recacheLayout();
    updateDotPosition();
  }

  // Listen to debounced resize if available (supports both native and jQuery triggers)
  document.addEventListener('debounced-window-resize', onResize);
  if (window.$) {
    $(document).on('debounced-window-resize.timelineMinimap', onResize);
  }

  return { update, dispose };
}
