import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

const STORAGE_KEY = 'aichat.artifact-panel-ratio';
const DEFAULT_RATIO = 0.52;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const readRatio = () => {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value >= 0.2 && value <= 0.8 ? value : DEFAULT_RATIO;
  } catch { return DEFAULT_RATIO; }
};

export function useArtifactResize(full: boolean) {
  const panelRef = useRef<HTMLElement>(null);
  const [preferred, setPreferred] = useState(readRatio);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; ratio: number; width: number } | null>(null);
  // Leave enough room for both the composer and the preview controls.
  const min = width ? Math.min(0.5, Math.max(0.2, 320 / width)) : 0.2;
  const max = width ? Math.max(min, Math.min(0.8, 1 - 280 / width)) : 0.8;
  const ratio = clamp(preferred, min, max);

  useLayoutEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return;
    const measure = () => setWidth(parent.getBoundingClientRect().width);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(parent);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => {
    if (dragging) return;
    try { localStorage.setItem(STORAGE_KEY, String(preferred)); } catch { /* Storage may be unavailable. */ }
  }, [preferred, dragging]);
  useEffect(() => {
    if (!dragging) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const cancel = () => { drag.current = null; setDragging(false); };
    window.addEventListener('blur', cancel);
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
      window.removeEventListener('blur', cancel);
    };
  }, [dragging]);
  useEffect(() => { if (full) { drag.current = null; setDragging(false); } }, [full]);

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    panelRef, dragging,
    style: { '--artifact-panel-width': `${ratio * 100}%` } as CSSProperties,
    separatorProps: {
      role: 'separator', tabIndex: 0, 'aria-label': '调整消息与预览宽度', 'aria-orientation': 'vertical' as const,
      'aria-valuemin': Math.round(min * 100), 'aria-valuemax': Math.round(max * 100),
      'aria-valuenow': Math.round(ratio * 100), 'aria-valuetext': `预览占 ${Math.round(ratio * 100)}%`,
      title: '拖动调整消息与预览宽度；双击恢复默认；方向键微调',
      onDoubleClick: () => setPreferred(DEFAULT_RATIO),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        let next: number;
        switch (event.key) {
          case 'ArrowLeft': next = ratio + 0.02; break;
          case 'ArrowRight': next = ratio - 0.02; break;
          case 'Home': next = min; break;
          case 'End': next = max; break;
          case 'Enter': next = DEFAULT_RATIO; break;
          default: return;
        }
        event.preventDefault();
        setPreferred(clamp(next, min, max));
      },
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !width || full) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, ratio, width };
        setDragging(true);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        setPreferred(clamp(start.ratio + (start.x - event.clientX) / start.width, min, max));
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    },
  };
}
