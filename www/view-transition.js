/**
 * Overlay-based view transition utility.
 *
 * Uses a manual requestAnimationFrame loop for opacity — no CSS transitions,
 * no Web Animations API, no transitionend listeners. Each frame we compute the
 * exact opacity from elapsed time. This is 100% deterministic.
 *
 *   1. Overlay fades in  (opacity 0 → 1)
 *   2. swapFn() called   (views switched instantly behind opaque overlay)
 *   3. Overlay fades out (opacity 1 → 0)
 *
 * Usage:
 *   ViewTransition.run(swapFn, durationMs?)
 */
const ViewTransition = {

  /** @type {HTMLElement|null} */ _overlay: null,
  _busy: false,
  _queue: null,
  _defaultDuration: 350,

  _getOverlay() {
    if (!this._overlay) {
      this._overlay = document.getElementById('viewTransitionOverlay');
    }
    return this._overlay;
  },

  run(swapFn, durationMs) {
    const duration = (typeof durationMs === 'number' && durationMs > 0) ? durationMs : this._defaultDuration;
    if (this._busy) {
      this._queue = { swapFn, duration };
      return Promise.resolve();
    }
    return this._execute(swapFn, duration);
  },

  instant(swapFn) {
    swapFn();
  },

  /**
   * Cubic-bezier(0.22, 1, 0.36, 1) approximation via ease-out quad.
   * Quick start, gentle deceleration.
   */
  _ease(t) {
    return t * (2 - t);
  },

  /**
   * Animate overlay opacity from `from` to `to` over `duration` ms
   * using a manual rAF loop. Returns a Promise that resolves when done.
   */
  _animateOpacity(overlay, from, to, duration) {
    return new Promise(resolve => {
      const start = performance.now();
      overlay.style.opacity = String(from);

      const step = (now) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / duration, 1);
        const eased = this._ease(t);
        const value = from + (to - from) * eased;
        overlay.style.opacity = String(value);

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          // Ensure we land exactly on the target
          overlay.style.opacity = String(to);
          resolve();
        }
      };

      requestAnimationFrame(step);
    });
  },

  /** Helper: wait for next animation frame. */
  _frame() {
    return new Promise(r => requestAnimationFrame(r));
  },

  /** Helper: wait ms. */
  _wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  },

  async _execute(swapFn, duration) {
    this._busy = true;
    const overlay = this._getOverlay();
    if (!overlay) {
      swapFn();
      this._busy = false;
      this._processQueue();
      return;
    }

    // Remove any leftover CSS transition — we handle everything in JS
    overlay.style.transition = 'none';

    // ── Phase 1: Fade overlay in (0 → 1) ───────────────────────
    await this._animateOpacity(overlay, 0, 1, duration);

    // ── Phase 2: Swap content behind the opaque overlay ────────
    try {
      swapFn();
    } catch (e) {
      console.error('ViewTransition swapFn error:', e);
    }

    // Wait for the browser to fully paint & composite the new view.
    // 3 rAF frames + 150ms settles any layout/paint/composite work.
    await this._frame();
    await this._frame();
    await this._frame();
    await this._wait(150);

    // ── Phase 3: Fade overlay out (1 → 0) ──────────────────────
    await this._animateOpacity(overlay, 1, 0, duration);

    this._busy = false;
    this._processQueue();
  },

  _processQueue() {
    if (this._queue) {
      const { swapFn, duration } = this._queue;
      this._queue = null;
      this._execute(swapFn, duration);
    }
  }
};

export default ViewTransition;
