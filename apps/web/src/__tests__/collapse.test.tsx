import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Collapse } from '../components/ui/Collapse.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('collapse', () => {
  it('switches within the commit when animation is unavailable', async () => {
    await act(async () => root.render(<Collapse open><p>body</p></Collapse>));
    expect(host.textContent).toBe('body');
    await act(async () => root.render(<Collapse open={false}><p>body</p></Collapse>));
    expect(host.textContent).toBe('');
    expect(host.firstElementChild!.hasAttribute('hidden')).toBe(true);
  });

  it('keeps the body mounted while it closes and removes it when the animation ends', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const animations: Array<{ keyframes: Keyframe[]; onfinish: (() => void) | null; cancel: () => void; playState: string }> = [];
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value(keyframes: Keyframe[]) {
        const animation = { keyframes, onfinish: null, cancel: vi.fn(), playState: 'running' };
        animations.push(animation);
        return animation;
      },
    });
    try {
      await act(async () => root.render(<Collapse open><p>body</p></Collapse>));
      expect(animations).toHaveLength(0); // already open: nothing to animate on mount
      await act(async () => root.render(<Collapse open={false}><p>body</p></Collapse>));
      expect(host.textContent).toBe('body');
      expect(host.firstElementChild!.hasAttribute('inert')).toBe(true);
      expect(animations[0]!.keyframes[1]).toMatchObject({ height: '0px', opacity: 0 });
      await act(async () => { animations[0]!.playState = 'finished'; animations[0]!.onfinish!(); });
      expect(host.textContent).toBe('');
      await act(async () => root.render(<Collapse open><p>body</p></Collapse>));
      expect(host.textContent).toBe('body');
      expect(animations[1]!.keyframes[0]).toMatchObject({ height: '0px', opacity: 0 });
    } finally {
      delete (Element.prototype as { animate?: unknown }).animate;
    }
  });
});
