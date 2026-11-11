/**
 * Appearance skins: the single source of truth for every palette in the app.
 *
 * A skin colours the light theme. Dark mode is one shared palette
 * (`DARK_VARIANT`, neutral black) whatever the skin, because per-skin darks
 * read as tinted slabs of navy, green or plum. Each variant carries two colour ramps —
 * `accent` (the brand hue) and `zinc` (the neutral hue, tinted to belong to the
 * same family) — plus the `chat` surface tokens. `lib/theme.ts` writes the
 * variant for the resolved mode onto `<html>` as inline custom properties, which
 * override the parchment fallbacks in `index.css` (`@theme` and `:root` /
 * `.dark`). Because every component reads `--color-*` / `--chat-*`, a skin
 * repaints the whole app without touching components, and the gallery previews
 * render from this same data so they can never drift from what gets painted.
 *
 * Skins are flat colour by design: no gradients. Depth comes from the surface
 * steps, hairlines and the paper grain, not from colour ramps in a background.
 *
 * The dark palette sits on one lightness ladder (OKLCH L) so the chat surfaces
 * and the `zinc-*` utilities components use line up instead of forming two
 * families of near-identical darks:
 *   zinc-950 #0e · bg #14 · surface = zinc-900 #1c · surfaceSoft #24 · zinc-800 #2a
 *   line #2e · controlLine #3c · zinc-700 #3a · zinc-600 #52
 * The dark palette has no chroma at all, and hairlines sit ~11 L above the
 * page, like the light theme's.
 */

export type SkinId = 'parchment' | 'celadon' | 'indigo' | 'plum' | 'graphite' | 'amber';

/** The eleven steps of a Tailwind colour ramp, in order. */
export const RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type Ramp = readonly [string, string, string, string, string, string, string, string, string, string, string];

/** Surface tokens that are not derived from the ramps. Keys map to `--chat-*`. */
export interface ChatTokens {
  bg: string;
  sidebarBg: string;
  line: string;
  ink: string;
  prose: string;
  surface: string;
  surfaceSoft: string;
  controlLine: string;
  accentSoft: string;
  accentLine: string;
  codeBg: string;
  codeFg: string;
  codeLine: string;
  codeComment: string;
  codeKeyword: string;
  codeEntity: string;
  codeConstant: string;
  codeString: string;
  btnBg: string;
  btnHover: string;
  btnFg: string;
  avatarBg: string;
  avatarFg: string;
}

export interface SkinVariant {
  accent: Ramp;
  zinc: Ramp;
  white: string;
  chat: ChatTokens;
}

export interface Skin {
  id: SkinId;
  name: string;
  tagline: string;
  /** The skin's palette; it applies in light mode only. */
  light: SkinVariant;
}

export const DEFAULT_SKIN: SkinId = 'parchment';

/**
 * The one dark palette: pure neutral black, no hue at all. Skins colour the
 * light theme only; in dark mode every skin is the same greys, and the accent
 * ramp is grey too, so emphasis comes from lightness (white-ish text, lighter
 * controls) rather than colour. Only syntax highlighting and status colours
 * (errors) keep a hue. Mirrors the `.dark` fallback in index.css.
 */
export const DARK_VARIANT: SkinVariant = {
  accent: ['#fafafa', '#f5f5f5', '#e5e5e5', '#d4d4d4', '#c4c4c4', '#a3a3a3', '#737373', '#525252', '#404040', '#262626', '#171717'],
  zinc: ['#fafafa', '#f5f5f5', '#e5e5e5', '#d4d4d4', '#a3a3a3', '#737373', '#525252', '#3a3a3a', '#2a2a2a', '#1c1c1c', '#0e0e0e'],
  white: '#ffffff',
  chat: {
    bg: '#141414', sidebarBg: 'rgba(20, 20, 20, 0.92)', line: 'rgba(46, 46, 46, 0.9)',
    ink: '#ededed', prose: '#d9d9d9', surface: '#1c1c1c', surfaceSoft: '#242424', controlLine: 'rgba(60, 60, 60, 0.85)',
    accentSoft: '#232323', accentLine: '#404040',
    codeBg: '#1c1c1c', codeFg: '#e0e0e0', codeLine: 'rgba(60, 60, 60, 0.6)',
    codeComment: '#808080', codeKeyword: '#c5a3e0', codeEntity: '#dcc690', codeConstant: '#8fbcd6', codeString: '#a9c79b',
    btnBg: '#2a2a2a', btnHover: '#363636', btnFg: '#f5f5f5',
    avatarBg: '#2e2e2e', avatarFg: '#d4d4d4',
  },
};

export const SKINS: readonly Skin[] = [
  {
    id: 'parchment',
    name: '暖纸',
    tagline: '米白纸面与陶土红，像一本摊开的旧书。',
    light: {
      accent: ['#fbf4ec', '#f7e6d7', '#eecbb0', '#e3a98a', '#dc8f6f', '#d97757', '#c05d3d', '#9e4a30', '#7a3a27', '#55291d', '#2f1710'],
      zinc: ['#fdfaef', '#f8f3e2', '#ece4cd', '#dcd2b4', '#b3a883', '#867c5c', '#5e573f', '#423c2a', '#2c2718', '#1e1b12', '#14120c'],
      white: '#fffdf6',
      chat: {
        bg: '#f8f3e2', sidebarBg: 'rgba(247, 242, 226, 0.86)', line: 'rgba(220, 210, 180, 0.7)',
        ink: '#241f14', prose: '#3b3524', surface: '#fffdf6', surfaceSoft: '#fdfaef', controlLine: 'rgba(220, 210, 180, 0.85)',
        accentSoft: '#fbf4ec', accentLine: '#eecbb0',
        codeBg: '#f3ecda', codeFg: '#3a3323', codeLine: 'rgba(220, 210, 180, 0.8)',
        codeComment: '#9a9070', codeKeyword: '#b04f26', codeEntity: '#7a6224', codeConstant: '#37656e', codeString: '#4f6b41',
        btnBg: '#2a2417', btnHover: '#3d3524', btnFg: '#fdfaef',
        avatarBg: '#f7e6d7', avatarFg: '#7a4526',
      },
    },
  },
  {
    id: 'celadon',
    name: '青瓷',
    tagline: '瓷青与松绿，雨后窑色一样安静。',
    light: {
      accent: ['#f0f7f4', '#dcefe8', '#b9dfd2', '#8cc7b4', '#5aa892', '#3d8f7a', '#2c7463', '#265e51', '#214c43', '#1d3f38', '#0f2622'],
      zinc: ['#f7faf8', '#f1f6f3', '#e2ebe6', '#c9d8d1', '#9db3aa', '#71887e', '#55685f', '#43524b', '#333f39', '#242e29', '#101614'],
      white: '#fdfffe',
      chat: {
        bg: '#f1f6f3', sidebarBg: 'rgba(241, 246, 243, 0.86)', line: 'rgba(201, 216, 209, 0.7)',
        ink: '#17211c', prose: '#2c3a33', surface: '#fdfffe', surfaceSoft: '#f7faf8', controlLine: 'rgba(201, 216, 209, 0.85)',
        accentSoft: '#f0f7f4', accentLine: '#b9dfd2',
        codeBg: '#e9f1ec', codeFg: '#26332c', codeLine: 'rgba(201, 216, 209, 0.8)',
        codeComment: '#8aa096', codeKeyword: '#22705f', codeEntity: '#96690f', codeConstant: '#3a6ea5', codeString: '#6a7f2a',
        btnBg: '#1d332c', btnHover: '#2a473d', btnFg: '#f1f6f3',
        avatarBg: '#dcefe8', avatarFg: '#265e51',
      },
    },
  },
  {
    id: 'indigo',
    name: '黛蓝',
    tagline: '蓝灰纸面与靛青，深夜书桌的台灯色。',
    light: {
      accent: ['#eef2ff', '#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#312e81', '#1e1b4b'],
      zinc: ['#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b', '#0f172a', '#0b1120'],
      white: '#ffffff',
      chat: {
        bg: '#f1f5f9', sidebarBg: 'rgba(241, 245, 249, 0.86)', line: 'rgba(203, 213, 225, 0.7)',
        ink: '#0f172a', prose: '#2b3a52', surface: '#ffffff', surfaceSoft: '#f8fafc', controlLine: 'rgba(203, 213, 225, 0.85)',
        accentSoft: '#eef2ff', accentLine: '#c7d2fe',
        codeBg: '#eaeff6', codeFg: '#24324a', codeLine: 'rgba(203, 213, 225, 0.8)',
        codeComment: '#8494ab', codeKeyword: '#4f46e5', codeEntity: '#9a6700', codeConstant: '#0e7490', codeString: '#3d7a44',
        btnBg: '#1e293b', btnHover: '#2b3a52', btnFg: '#f1f5f9',
        avatarBg: '#e0e7ff', avatarFg: '#4338ca',
      },
    },
  },
  {
    id: 'plum',
    name: '绛紫',
    tagline: '藕灰与绛纱，暮色里的一点暖意。',
    light: {
      accent: ['#fbf3f7', '#f7e3ee', '#efc4dc', '#e29cc0', '#d1719f', '#bf4f85', '#a63a6c', '#8a2f58', '#722b4b', '#612741', '#381224'],
      zinc: ['#faf8fa', '#f5f2f5', '#e9e2e9', '#d5c9d6', '#ab9cae', '#7f7183', '#615565', '#4c4250', '#38303c', '#261f2a', '#171219'],
      white: '#fffdff',
      chat: {
        bg: '#f5f2f5', sidebarBg: 'rgba(245, 242, 245, 0.86)', line: 'rgba(213, 201, 214, 0.7)',
        ink: '#241a26', prose: '#3d3240', surface: '#fffdff', surfaceSoft: '#faf8fa', controlLine: 'rgba(213, 201, 214, 0.85)',
        accentSoft: '#fbf3f7', accentLine: '#efc4dc',
        codeBg: '#f0e9f0', codeFg: '#362b39', codeLine: 'rgba(213, 201, 214, 0.8)',
        codeComment: '#9a8c9d', codeKeyword: '#a63a6c', codeEntity: '#8a6d1f', codeConstant: '#4f6bb0', codeString: '#5c7a45',
        btnBg: '#322236', btnHover: '#443049', btnFg: '#f5f2f5',
        avatarBg: '#f7e3ee', avatarFg: '#8a2f58',
      },
    },
  },
  {
    id: 'graphite',
    name: '石墨',
    tagline: '纯灰与朱红，报刊排版般的克制。',
    light: {
      accent: ['#fef3f2', '#fee4e2', '#fecdc9', '#fdaaa4', '#f97066', '#f04438', '#d92d20', '#b42318', '#912018', '#7a271a', '#55160c'],
      zinc: ['#fafafa', '#f4f4f5', '#e4e4e7', '#d4d4d8', '#a1a1aa', '#71717a', '#52525b', '#3f3f46', '#27272a', '#18181b', '#0c0c0e'],
      white: '#ffffff',
      chat: {
        bg: '#f4f4f5', sidebarBg: 'rgba(244, 244, 245, 0.86)', line: 'rgba(212, 212, 216, 0.7)',
        ink: '#18181b', prose: '#303036', surface: '#ffffff', surfaceSoft: '#fafafa', controlLine: 'rgba(212, 212, 216, 0.85)',
        accentSoft: '#fef3f2', accentLine: '#fecdc9',
        codeBg: '#ededf0', codeFg: '#2a2a30', codeLine: 'rgba(212, 212, 216, 0.8)',
        codeComment: '#8e8e98', codeKeyword: '#d92d20', codeEntity: '#9a6700', codeConstant: '#1d6fb8', codeString: '#3d7a44',
        btnBg: '#18181b', btnHover: '#2c2c31', btnFg: '#fafafa',
        avatarBg: '#fee4e2', avatarFg: '#b42318',
      },
    },
  },
  {
    id: 'amber',
    name: '琥珀',
    tagline: '暖灰与蜜金，午后斜照进来的光。',
    light: {
      accent: ['#fffbeb', '#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#c46a08', '#a3540a', '#92400e', '#78350f', '#451a03'],
      zinc: ['#faf9f7', '#f4f2ee', '#e7e3db', '#d3cdc0', '#a8a091', '#7d7668', '#5f594e', '#4a453c', '#34302a', '#23201c', '#161411'],
      white: '#fffefa',
      chat: {
        bg: '#f4f2ee', sidebarBg: 'rgba(244, 242, 238, 0.86)', line: 'rgba(211, 205, 192, 0.7)',
        ink: '#201c15', prose: '#3a352b', surface: '#fffefa', surfaceSoft: '#faf9f7', controlLine: 'rgba(211, 205, 192, 0.85)',
        accentSoft: '#fffbeb', accentLine: '#fde68a',
        codeBg: '#eeeae1', codeFg: '#322d23', codeLine: 'rgba(211, 205, 192, 0.8)',
        codeComment: '#948c7a', codeKeyword: '#b45309', codeEntity: '#7a6224', codeConstant: '#37656e', codeString: '#4f6b41',
        btnBg: '#2b2419', btnHover: '#3d3524', btnFg: '#f4f2ee',
        avatarBg: '#fef3c7', avatarFg: '#a3540a',
      },
    },
  },
];

/** The palette actually painted for a skin in a resolved mode. */
export function variantFor(skin: Skin, mode: 'light' | 'dark'): SkinVariant {
  return mode === 'dark' ? DARK_VARIANT : skin.light;
}

export function findSkin(id: string): Skin | undefined {
  return SKINS.find((s) => s.id === id);
}

const CHAT_VAR: Record<keyof ChatTokens, string> = {
  bg: '--chat-bg',
  sidebarBg: '--sidebar-bg',
  line: '--chat-line',
  ink: '--chat-ink',
  prose: '--chat-prose',
  surface: '--chat-surface',
  surfaceSoft: '--chat-surface-soft',
  controlLine: '--chat-control-line',
  accentSoft: '--chat-accent-soft',
  accentLine: '--chat-accent-line',
  codeBg: '--chat-code-bg',
  codeFg: '--chat-code-fg',
  codeLine: '--chat-code-line',
  codeComment: '--chat-code-comment',
  codeKeyword: '--chat-code-keyword',
  codeEntity: '--chat-code-entity',
  codeConstant: '--chat-code-constant',
  codeString: '--chat-code-string',
  btnBg: '--chat-btn-bg',
  btnHover: '--chat-btn-hover',
  btnFg: '--chat-btn-fg',
  avatarBg: '--chat-avatar-bg',
  avatarFg: '--chat-avatar-fg',
};

/** Every custom property a variant paints onto `<html>`. */
export function skinVars(variant: SkinVariant): Record<string, string> {
  const vars: Record<string, string> = { '--color-white': variant.white };
  RAMP_STEPS.forEach((step, i) => {
    vars[`--color-accent-${step}`] = variant.accent[i];
    vars[`--color-zinc-${step}`] = variant.zinc[i];
  });
  for (const key of Object.keys(CHAT_VAR) as (keyof ChatTokens)[]) {
    vars[CHAT_VAR[key]] = variant.chat[key];
  }
  return vars;
}
