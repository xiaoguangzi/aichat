import { afterEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QuoteSelection } from '../components/chat/QuoteSelection.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  window.getSelection()?.removeAllRanges();
});

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const onQuote = vi.fn();
  await act(async () => root.render(<QuoteSelection onQuote={onQuote}>
    <div data-quote-text><p>First paragraph</p><pre><code>  second line</code></pre></div>
    <p data-user>User message</p>
  </QuoteSelection>));
  return onQuote;
}

function select(start: Node, end = start) {
  const range = document.createRange();
  range.setStart(start, 0);
  range.setEnd(end, end.textContent!.length);
  range.getBoundingClientRect = () => ({ left: 20, bottom: 40 }) as DOMRect;
  range.getClientRects = () => [{ left: 20, right: 100, top: 20, bottom: 40 }] as unknown as DOMRectList;
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

it('quotes a partial reply spanning paragraphs and code without user content', async () => {
  const onQuote = await mount();
  select(host.querySelector('p')!.firstChild!, host.querySelector('code')!.firstChild!);
  await act(async () => document.dispatchEvent(new Event('selectionchange')));
  const button = document.querySelector<HTMLButtonElement>('[aria-label="引用选中内容"]')!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
  expect(onQuote).toHaveBeenCalledWith('First paragraph  second line');
  expect(document.querySelector('[aria-label="引用选中内容"]')).toBeNull();
});

it('preserves native menus outside the selection and with Shift', async () => {
  await mount();
  const reply = host.querySelector('p')!;
  select(reply.firstChild!);
  for (const options of [{ clientX: 150, clientY: 25 }, { clientX: 25, clientY: 25, shiftKey: true }]) {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...options });
    await act(async () => { reply.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  }
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 25, clientY: 25 });
  await act(async () => { reply.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
});

it('rejects user selections and mixed selections, and closes on Escape', async () => {
  await mount();
  const reply = host.querySelector('p')!.firstChild!;
  const user = host.querySelector('[data-user]')!.firstChild!;
  for (const start of [user, reply]) {
    select(start, user);
    await act(async () => document.dispatchEvent(new Event('selectionchange')));
    expect(document.querySelector('[aria-label="引用选中内容"]')).toBeNull();
  }
  select(reply);
  await act(async () => document.dispatchEvent(new Event('selectionchange')));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(document.querySelector('[aria-label="引用选中内容"]')).toBeNull();
});
