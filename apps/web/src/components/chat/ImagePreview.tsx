import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Keep the native modal in the top layer, outside the scrolling message list. */
export function ImagePreview({ src }: { src: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const modal = dialog.current;
    modal?.showModal();
    return () => {
      modal?.close();
      trigger.current?.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="预览图片"
        onClick={() => setOpen(true)}
        className="max-w-full cursor-zoom-in rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-500"
      >
        <img src={src} className="max-h-52 rounded-xl object-contain ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-xs" alt="已发送的图片" />
      </button>
      {open && createPortal(
        <dialog
          ref={dialog}
          aria-label="图片预览"
          onCancel={() => setOpen(false)}
          onClose={() => setOpen(false)}
          onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
          className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-4 backdrop:bg-black/80 open:flex open:items-center open:justify-center sm:p-12"
        >
          <button
            type="button"
            autoFocus
            aria-label="关闭图片预览"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 rounded-full bg-black/60 p-3 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white"
          >
            <X size={22} />
          </button>
          <img src={src} alt="图片预览" className="max-h-full max-w-full object-contain" />
        </dialog>,
        document.body,
      )}
    </>
  );
}
