/**
 * Shared motion vocabulary for the chat surface. CSS owns the declarative part (see the motion
 * tokens in index.css); this file is what JS-driven motion (WAAPI) agrees on.
 */

/** Matches `--ease-out` in index.css: quick departure, long soft landing. */
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Motion is opt-in by capability. Where the preference cannot be read (jsdom, an embedded
 * webview without `matchMedia`) or the reader asked for reduced motion, everything lands in its
 * final state at once — no loops, no intermediate frames.
 */
export function motionOK(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** WAAPI is present in every browser we target; its absence means "render the end state". */
export function canAnimate(el: Element | null | undefined): el is Element {
  return !!el && typeof el.animate === 'function' && motionOK();
}

/**
 * A looping CSS animation restarts whenever its element remounts, which happens constantly while
 * a reply streams (placeholder → live message → persisted message). Starting every loop at the
 * same point of a wall-clock period keeps the phase continuous across those handoffs.
 */
export function loopPhase(periodMs: number): string {
  return `-${Date.now() % periodMs}ms`;
}
