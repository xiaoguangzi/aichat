import { useEffect, useState } from 'react';
import {
  applySkin, applyTheme, getStoredSkin, getStoredTheme, onSkinChange, onThemeChange, resolveTheme,
  type ResolvedTheme, type SkinId, type Theme,
} from './theme.js';

/**
 * Live appearance state for pickers and the settings gallery: the chosen mode,
 * the chosen skin, and the mode actually painted (so previews match the app).
 * Subscribes to both explicit switches and OS preference changes.
 */
export function useAppearance(): {
  theme: Theme;
  skin: SkinId;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  setSkin: (skin: SkinId) => void;
} {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [skin, setSkin] = useState<SkinId>(getStoredSkin);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme());
  useEffect(() => onThemeChange((r) => { setResolved(r); setTheme(getStoredTheme()); }), []);
  useEffect(() => onSkinChange(setSkin), []);
  return { theme, skin, resolved, setTheme: applyTheme, setSkin: applySkin };
}
