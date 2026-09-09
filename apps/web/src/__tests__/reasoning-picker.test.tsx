import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReasoningPicker } from '../components/chat/ReasoningPicker.js';
import { useChat } from '../store/chat.js';

vi.mock('../store/settings.js', () => ({ useAllModels: () => [{ id: 'm', isDefault: true, caps: { thinking: true }, reasoningMap: null }] }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let anchor: DOMRect;
beforeEach(() => {
  useChat.setState({ current: null, draftModelId: 'm', draftReasoning: 'high', running: false });
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 500);
  anchor = { left: 300, right: 380, top: 350, bottom: 380, width: 80, height: 30 } as DOMRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => anchor);
  host = document.createElement('div');
  host.style.overflow = 'hidden';
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.removeItem('aichat.reasoning');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function open() {
  await act(async () => root.render(<ReasoningPicker />));
  await act(async () => host.querySelector('button')!.click());
  return document.querySelector<HTMLDivElement>('[role="listbox"]')!;
}

it('escapes the clipping container and bounds the scrollable menu above a low anchor', async () => {
  const menu = await open();
  expect(menu.parentElement).toBe(document.body);
  expect(host.contains(menu)).toBe(false);
  expect(menu.style.left).toBe('62px');
  expect(menu.style.bottom).toBe('158px');
  expect(menu.style.maxHeight).toBe('334px');
  expect(menu.querySelector('.overflow-y-auto')).not.toBeNull();
  expect(menu.querySelectorAll('[role="option"]')).toHaveLength(7);
  expect(menu.querySelector('.line-clamp-1')).toBeNull();
});

it('flips below the anchor on resize and updates position when the page scrolls', async () => {
  const menu = await open();
  anchor = { ...anchor, top: 80, bottom: 110 };
  await act(async () => window.dispatchEvent(new Event('resize')));
  expect(menu.style.top).toBe('118px');
  expect(menu.style.bottom).toBe('');
  expect(menu.style.maxHeight).toBe('374px');
  anchor = { ...anchor, top: 100, bottom: 130 };
  await act(async () => window.dispatchEvent(new Event('scroll')));
  expect(menu.style.top).toBe('138px');
  anchor = { ...anchor, top: -100, bottom: -70 };
  await act(async () => window.dispatchEvent(new Event('scroll')));
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});

it('keeps portal options clickable, saves the chosen level, and dismisses outside', async () => {
  const menu = await open();
  const option = menu.querySelector<HTMLButtonElement>('[role="option"]')!;
  await act(async () => option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(document.body.contains(menu)).toBe(true);
  await act(async () => option.click());
  expect(useChat.getState().draftReasoning).toBe('off');
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  await act(async () => host.querySelector('button')!.click());
  await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});
