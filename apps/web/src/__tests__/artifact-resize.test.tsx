import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useArtifactResize } from '../components/artifacts/useArtifactResize.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let width = 1000;
const key = 'aichat.artifact-panel-ratio';
function Harness() {
  const resize = useArtifactResize(false);
  return <div><aside ref={resize.panelRef} style={resize.style}><div {...resize.separatorProps} />{resize.dragging && <span>Dragging</span>}</aside></div>;
}
beforeEach(() => {
  localStorage.clear(); width = 1000;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, left: 200, right: 200 + width, top: 0, bottom: 800, height: 800, x: 200, y: 0, toJSON: () => ({}) }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const mount = () => act(async () => root.render(<Harness />));
const handle = () => host.querySelector<HTMLElement>('[role="separator"]')!;
const ratio = () => Number(handle().getAttribute('aria-valuenow'));
const pointer = async (type: string, x: number) => {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  await act(async () => { handle().dispatchEvent(e); });
};

it('drags in both directions, keeps usable widths and persists when released', async () => {
  await mount();
  handle().setPointerCapture = vi.fn();
  handle().hasPointerCapture = () => true;
  handle().releasePointerCapture = vi.fn();
  await pointer('pointerdown', 680);
  await pointer('pointermove', 500);
  expect(ratio()).toBe(70);
  expect(document.body.style.userSelect).toBe('none');
  expect(localStorage.getItem(key)).toBe('0.52');
  await pointer('pointermove', -500);
  expect(ratio()).toBe(72); // 280px left for chat
  await pointer('pointermove', 1600);
  expect(ratio()).toBe(32); // 320px left for preview
  await pointer('pointerup', 1600);
  expect(localStorage.getItem(key)).toBe('0.32');
  expect(document.body.style.userSelect).toBe('');
  expect(host.textContent).not.toContain('Dragging');
});

it('restores preference, adapts to container resize and resets with double-click', async () => {
  localStorage.setItem(key, '0.7');
  await mount();
  expect(ratio()).toBe(70);
  width = 700;
  await act(async () => { window.dispatchEvent(new Event('resize')); });
  expect(ratio()).toBe(60);
  expect(localStorage.getItem(key)).toBe('0.7'); // Temporary narrow windows do not erase preference.
  width = 1000;
  await act(async () => { window.dispatchEvent(new Event('resize')); });
  expect(ratio()).toBe(70);
  await act(async () => { handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(ratio()).toBe(52);
  expect(localStorage.getItem(key)).toBe('0.52');
});

it('supports keyboard adjustment and clears global drag styles on unmount', async () => {
  localStorage.setItem(key, 'invalid');
  await mount();
  await act(async () => { handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
  expect(ratio()).toBe(54);
  handle().setPointerCapture = vi.fn();
  await pointer('pointerdown', 600);
  expect(document.body.style.cursor).toBe('col-resize');
  await act(async () => root.render(<div>Closed</div>));
  expect(document.body.style.cursor).toBe('');
  expect(document.body.style.userSelect).toBe('');
});
