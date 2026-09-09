const THEME_KEY = 'aichat.theme';

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

const listeners = new Set<(resolved: ResolvedTheme) => void>();

/** Subscribe to effective-theme changes — explicit switches and OS changes alike. */
export function onThemeChange(fn: (resolved: ResolvedTheme) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function paint(theme: Theme) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  // keep native UI (scrollbars, form controls) on the same side as the CSS
  root.style.colorScheme = resolved;
  for (const fn of listeners) fn(resolved);
}

export function applyTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  paint(theme);
}

// Auto-initialize on load (without persisting the default).
if (typeof window !== 'undefined') {
  paint(getStoredTheme());
  darkQuery()?.addEventListener('change', () => {
    if (getStoredTheme() === 'system') paint('system');
  });
}
