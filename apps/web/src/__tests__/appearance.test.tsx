import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { DARK_VARIANT, DEFAULT_SKIN, RAMP_STEPS, SKINS, findSkin, skinVars, variantFor } from '../lib/skins.js';
import { applySkin, applyTheme, getStoredSkin, resolveTheme } from '../lib/theme.js';
import { AppearanceSettingsPage } from '../pages/AppearanceSettingsPage';
import { ThemePicker } from '../components/chat/ThemePicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** OKLCH as [L 0–100, C ×100, h°] for `#rrggbb` or `rgba(r, g, b, a)` (alpha ignored). */
function oklch(s: string): [number, number, number] {
  const ch = s.startsWith('#') ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) : s.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const [r, g, b] = ch.map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q;
  return [(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q) * 100, Math.hypot(A, B) * 100, ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

const root = document.documentElement;
function normalize() {
  localStorage.clear();
  root.classList.remove('dark');
  root.removeAttribute('data-skin');
  root.style.cssText = '';
  applyTheme('light');
  applySkin(DEFAULT_SKIN);
}
beforeEach(normalize);

describe('skin registry', () => {
  it('exposes six unique skins with complete palettes, plus the shared dark one', () => {
    expect(SKINS).toHaveLength(6);
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(6);
    expect(findSkin(DEFAULT_SKIN)).toBeDefined();
    const hex = /^#[0-9a-f]{6}$/i;
    for (const s of SKINS) {
      for (const variant of [s.light, DARK_VARIANT]) {
        expect(variant.accent).toHaveLength(RAMP_STEPS.length);
        expect(variant.zinc).toHaveLength(RAMP_STEPS.length);
        for (const c of [...variant.accent, ...variant.zinc, variant.white]) expect(c).toMatch(hex);
        for (const value of Object.values(variant.chat)) expect(value.length).toBeGreaterThan(0);
        expect(variant.chat.bg).not.toBe(variant.chat.surface);
      }
      // light and dark must actually differ
      expect(s.light.chat.bg).not.toBe(DARK_VARIANT.chat.bg);
    }
  });

  it('uses one dark palette for every skin', () => {
    for (const s of SKINS) {
      expect(variantFor(s, 'dark')).toBe(DARK_VARIANT);
      expect(variantFor(s, 'light')).toBe(s.light);
    }
  });

  it('keeps the dark palette neutral and on its ladder: aligned surfaces, quiet hairlines', () => {
    const z = (step: (typeof RAMP_STEPS)[number]) => DARK_VARIANT.zinc[RAMP_STEPS.indexOf(step)];
    const c = DARK_VARIANT.chat;
    const L = (s: string) => oklch(s)[0];
    // components' zinc-900 cards are the same colour as the chat surface
    expect(z(900)).toBe(c.surface);
    expect(L(z(950))).toBeLessThan(L(c.bg));
    expect(L(c.bg)).toBeLessThan(L(c.surface));
    expect(L(c.surface)).toBeLessThan(L(c.surfaceSoft));
    expect(L(c.surfaceSoft)).toBeLessThan(L(z(800)));
    // a hairline, not a grid: roughly the contrast the light theme uses
    expect(L(c.line) - L(c.bg)).toBeGreaterThan(6);
    expect(L(c.line) - L(c.bg)).toBeLessThan(15);
    // pure neutral: no hue anywhere except syntax highlighting
    const neutral = [...DARK_VARIANT.zinc, ...DARK_VARIANT.accent, c.bg, c.sidebarBg, c.line, c.ink, c.prose, c.surface, c.surfaceSoft,
      c.controlLine, c.accentSoft, c.accentLine, c.btnBg, c.btnHover, c.btnFg, c.avatarBg, c.avatarFg, c.codeBg, c.codeFg, c.codeComment];
    for (const s of neutral) expect(oklch(s)[1], s).toBeLessThan(0.5);
  });

  it('maps a variant to every ramp, white and chat custom property', () => {
    const vars = skinVars(SKINS[1].light);
    for (const step of RAMP_STEPS) {
      expect(vars[`--color-accent-${step}`]).toBe(SKINS[1].light.accent[RAMP_STEPS.indexOf(step)]);
      expect(vars[`--color-zinc-${step}`]).toBeDefined();
    }
    expect(vars['--color-white']).toBe(SKINS[1].light.white);
    expect(vars['--chat-bg']).toBe(SKINS[1].light.chat.bg);
    expect(vars['--sidebar-bg']).toBe(SKINS[1].light.chat.sidebarBg);
    expect(vars['--chat-btn-bg']).toBe(SKINS[1].light.chat.btnBg);
    expect(Object.keys(vars)).toHaveLength(RAMP_STEPS.length * 2 + 1 + Object.keys(SKINS[1].light.chat).length);
  });
});

describe('applySkin / mode interplay', () => {
  it('persists the choice and paints its variables onto <html>', () => {
    applySkin('indigo');
    expect(localStorage.getItem('aichat.skin')).toBe('indigo');
    expect(getStoredSkin()).toBe('indigo');
    expect(root.dataset.skin).toBe('indigo');
    expect(root.style.getPropertyValue('--color-accent-500')).toBe(findSkin('indigo')!.light.accent[5]);
    expect(root.style.getPropertyValue('--chat-bg')).toBe(findSkin('indigo')!.light.chat.bg);
  });

  it('paints the shared dark palette in dark mode and the skin in light mode', () => {
    applySkin('celadon');
    applyTheme('dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.style.getPropertyValue('--chat-bg')).toBe(DARK_VARIANT.chat.bg);
    expect(root.style.getPropertyValue('--color-accent-500')).toBe(DARK_VARIANT.accent[5]);
    expect(root.dataset.skin).toBe('celadon');
    applyTheme('light');
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.style.getPropertyValue('--chat-bg')).toBe(findSkin('celadon')!.light.chat.bg);
    // skin survives a mode switch
    expect(getStoredSkin()).toBe('celadon');
  });

  it('falls back to the default for an unknown stored skin', () => {
    localStorage.setItem('aichat.skin', 'does-not-exist');
    expect(getStoredSkin()).toBe(DEFAULT_SKIN);
  });

  it('resolves system mode without matchMedia to light', () => {
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });
});

describe('AppearanceSettingsPage', () => {
  let host: HTMLDivElement;
  let reactRoot: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); reactRoot = createRoot(host); });
  afterEach(async () => { await act(async () => reactRoot.unmount()); host.remove(); });
  const mount = async () => { await act(async () => reactRoot.render(<MemoryRouter><AppearanceSettingsPage /></MemoryRouter>)); };
  const click = async (el: Element) => { await act(async () => { (el as HTMLButtonElement).click(); }); };

  it('lists every skin and applies one on click', async () => {
    await mount();
    for (const s of SKINS) expect(host.textContent).toContain(s.name);
    const card = host.querySelector<HTMLButtonElement>('button[aria-label="青瓷主题"]')!;
    expect(card.getAttribute('aria-pressed')).toBe('false');
    await click(card);
    expect(getStoredSkin()).toBe('celadon');
    expect(root.dataset.skin).toBe('celadon');
    expect(host.querySelector('button[aria-label="青瓷主题"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('使用中');
  });

  it('switches mode and resets to the default skin', async () => {
    await mount();
    const dark = [...host.querySelectorAll('[role="group"][aria-label="明暗模式"] button')].find((b) => b.textContent?.includes('深色'))!;
    await click(dark);
    expect(root.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('aichat.theme')).toBe('dark');

    const reset = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('恢复默认'))!;
    expect((reset as HTMLButtonElement).disabled).toBe(true); // already default
    await click(host.querySelector('button[aria-label="石墨主题"]')!);
    expect(getStoredSkin()).toBe('graphite');
    expect((reset as HTMLButtonElement).disabled).toBe(false);
    await click(reset);
    expect(getStoredSkin()).toBe(DEFAULT_SKIN);
  });
});

describe('ThemePicker quick switcher', () => {
  let host: HTMLDivElement;
  let reactRoot: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); reactRoot = createRoot(host); });
  afterEach(async () => { await act(async () => reactRoot.unmount()); host.remove(); });
  const mount = async () => { await act(async () => reactRoot.render(<MemoryRouter><ThemePicker /></MemoryRouter>)); };
  const click = async (el: Element) => { await act(async () => { (el as HTMLButtonElement).click(); }); };

  it('opens a dialog with skins and a link to full appearance settings', async () => {
    await mount();
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
    await click(trigger);
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    for (const s of SKINS) expect(dialog.querySelector(`button[aria-label="${s.name}主题"]`)).toBeTruthy();
    expect(dialog.querySelector('a[href="/settings/appearance"]')).toBeTruthy();
    await click(dialog.querySelector('button[aria-label="琥珀主题"]')!);
    expect(getStoredSkin()).toBe('amber');
    expect(root.style.getPropertyValue('--chat-bg')).toBe(findSkin('amber')!.light.chat.bg);
  });
});
