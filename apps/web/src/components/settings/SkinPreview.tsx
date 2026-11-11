import type { CSSProperties } from 'react';
import type { SkinVariant } from '../../lib/skins.js';

/**
 * A tiny flat mockup of the chat surface painted entirely from a skin variant's
 * own colours (inline styles), so the gallery shows each theme truthfully no
 * matter which skin is currently active. No gradients — just surface steps,
 * hairlines and the accent, mirroring how the real app is built.
 */
export function SkinPreview({ variant, className }: { variant: SkinVariant; className?: string }) {
  const { accent, zinc, chat } = variant;
  const line = (w: string, color: string, h = 5): CSSProperties => ({
    width: w, height: h, borderRadius: 3, background: color,
  });
  return (
    <div
      aria-hidden
      className={className}
      style={{
        display: 'flex', overflow: 'hidden', aspectRatio: '16 / 9',
        background: chat.bg, border: `1px solid ${chat.line}`, borderRadius: 12,
      }}
    >
      {/* sidebar */}
      <div style={{ width: '30%', flexShrink: 0, background: chat.surfaceSoft, borderRight: `1px solid ${chat.line}`, padding: '9px 8px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ height: 13, width: '86%', borderRadius: 6, background: chat.btnBg }} />
        <div style={{ height: 6, width: '92%', borderRadius: 3, background: accent[1] }} />
        <div style={line('72%', zinc[3], 6)} />
        <div style={line('82%', zinc[3], 6)} />
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 11, height: 11, borderRadius: '50%', background: chat.avatarBg, border: `1px solid ${chat.line}` }} />
          <div style={line('52%', zinc[4], 5)} />
        </div>
      </div>
      {/* main column */}
      <div style={{ flex: 1, minWidth: 0, padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 1, background: chat.line, marginBottom: 1 }} />
        {/* user turn */}
        <div style={{ alignSelf: 'flex-end', width: '56%', height: 15, borderRadius: '9px 9px 3px 9px', background: accent[6] }} />
        {/* assistant surface */}
        <div style={{ background: chat.surface, border: `1px solid ${chat.line}`, borderRadius: 9, padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: accent[5] }} />
            <div style={line('42%', zinc[4], 5)} />
          </div>
          <div style={line('94%', chat.prose)} />
          <div style={line('78%', chat.prose)} />
          <div style={line('60%', zinc[4])} />
          {/* code chip */}
          <div style={{ marginTop: 2, height: 15, borderRadius: 5, background: chat.codeBg, border: `1px solid ${chat.codeLine}`, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px' }}>
            <div style={line('16%', chat.codeKeyword, 5)} />
            <div style={line('30%', chat.codeString, 5)} />
            <div style={line('20%', chat.codeConstant, 5)} />
            <div style={line('12%', chat.codeFg, 5)} />
          </div>
        </div>
      </div>
    </div>
  );
}
