import { afterEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThinkingBlock } from '../components/chat/ThinkingBlock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

async function mount(text: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<ThinkingBlock text={text} streaming />));
  return host.querySelector<HTMLDivElement>('[data-thinking-body]')!;
}

function scrollable(el: HTMLDivElement) {
  let top = 0;
  let scrollHeight = 400;
  Object.defineProperties(el, {
    clientHeight: { get: () => 320 },
    scrollHeight: { get: () => scrollHeight },
    scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, scrollHeight - 320)); } },
  });
  return {
    grow: async (text: string, next: number) => {
      scrollHeight = next;
      await act(async () => root.render(<ThinkingBlock text={text} streaming />));
    },
    top: () => top,
    setTop: (value: number) => { el.scrollTop = value; },
    scroll: () => el.dispatchEvent(new Event('scroll')),
  };
}

describe('thinking block scroll following', () => {
  it('keeps the newest streaming text in view inside the capped area', async () => {
    const body = await mount('first');
    const scroll = scrollable(body);
    await scroll.grow('first\nsecond', 1000);
    expect(scroll.top()).toBe(680);
    await scroll.grow('first\nsecond\nthird', 1600);
    expect(scroll.top()).toBe(1280);
  });

  it('pauses when the reader scrolls up and resumes at the bottom', async () => {
    const body = await mount('first');
    const scroll = scrollable(body);
    await scroll.grow('first\nsecond', 1000);
    expect(scroll.top()).toBe(680);

    body.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    scroll.setTop(200);
    scroll.scroll();
    await scroll.grow('first\nsecond\nthird', 1600);
    expect(scroll.top()).toBe(200);

    scroll.setTop(1280);
    scroll.scroll();
    await scroll.grow('first\nsecond\nthird\nfourth', 2000);
    expect(scroll.top()).toBe(1680);
  });
});
