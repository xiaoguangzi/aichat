import { DEFAULT_SKIN, findSkin, SKINS, skinVars, variantFor, type SkinId } from './skins.js';

export type { SkinId } from './skins.js';

const THEME_KEY = 'aichat.theme';
const SKIN_KEY = 'aichat.skin';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

function darkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* private mode */
  }
  return 'system';
}

/** The theme actually painted: `system` follows the OS, the others are themselves. */
export function resolveTheme(theme: Theme = getStoredTheme()): ResolvedTheme {
  if (theme === 'light' || theme === 'dark') return theme;
  return darkQuery()?.matches ? 'dark' : 'light';
}

export function getStoredSkin(): SkinId {
  try {
    const v = localStorage.getItem(SKIN_KEY);
    if (v && findSkin(v)) return v as SkinId;
  } catch {
    /* private mode */
  }
  return DEFAULT_SKIN;
}

const listeners = new Set<(resolved: ResolvedTheme) => void>();
const skinListeners = new Set<(skin: SkinId) => void>();

/** Subscribe to effective-theme changes — explicit switches and OS changes alike. */
export function onThemeChange(fn: (resolved: ResolvedTheme) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Subscribe to skin (palette) changes. Also fires when the mode repaints it. */
export function onSkinChange(fn: (skin: SkinId) => void): () => void {
  skinListeners.add(fn);
  return () => {
    skinListeners.delete(fn);
  };
}

function paint(theme: Theme) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  // keep native UI (scrollbars, form controls) on the same side as the CSS
  root.style.colorScheme = resolved;
  // Paint the active skin's palette (or the shared dark palette). Inline custom
  // properties override the parchment fallbacks in index.css, so every
  // `--color-*` / `--chat-*` reader repaints without touching components.
  const skin = findSkin(getStoredSkin()) ?? SKINS[0];
  root.dataset.skin = skin.id;
  const vars = skinVars(variantFor(skin, resolved));
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  for (const fn of listeners) fn(resolved);
  for (const fn of skinListeners) fn(skin.id);
}

export function applyTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  paint(theme);
}

export function applySkin(skin: SkinId) {
  try {
    localStorage.setItem(SKIN_KEY, skin);
  } catch {
    /* ignore */
  }
  paint(getStoredTheme());
}

// Auto-initialize on load (without persisting the default).
if (typeof window !== 'undefined') {
  paint(getStoredTheme());
  darkQuery()?.addEventListener('change', () => {
    if (getStoredTheme() === 'system') paint('system');
  });
}
