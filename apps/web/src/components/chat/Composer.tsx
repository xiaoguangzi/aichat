import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { Attachment } from '@aichat/shared';
import { Paperclip, Send, Square, X, Loader2 } from 'lucide-react';
import { api } from '../../api/client';
import { useChat } from '../../store/chat';
import { useSettings, useAllModels } from '../../store/settings';
import { WebSearchToggle } from './WebSearchToggle.js';
import { SlashMenu } from './SlashMenu';
import { ReasoningPicker } from './ReasoningPicker';
import { formatBytes, cn } from '../../lib/utils';

export function Composer({ quote, starter }: { quote?: { text: string; conversationId: string | undefined } | null; starter?: { text: string } | null }) {
  const send = useChat((s) => s.send);
  const stop = useChat((s) => s.stop);
  const running = useChat((s) => s.running);
  const current = useChat((s) => s.current);
  const draftModelId = useChat((s) => s.draftModelId);
  const skills = useSettings((s) => s.skills);
  const models = useAllModels();

  const [text, setText] = useState('');
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeModelId = current?.modelId ?? draftModelId;
  const model = models.find((m) => m.id === activeModelId) ?? models.find((m) => m.isDefault);

  // Upload filter follows the model's declared input modalities; unknown model = allow everything.
  const canImage = model?.caps.image !== false;
  const canPdf = model?.caps.pdf !== false;
  // Office files are extracted to text server-side, so every model can take them.
  const alwaysOk = '.txt,.md,.json,.csv,text/*,.docx,.xlsx,.pptx';
  const accept = canImage && canPdf ? undefined : [canImage && 'image/*', canPdf && '.pdf,application/pdf', alwaysOk].filter(Boolean).join(',');
  const attachTitle = canImage && canPdf ? 'Attach file' : `Attach file (this model takes no ${[!canImage && 'images', !canPdf && 'PDFs'].filter(Boolean).join(' or ')})`;
  const slash = /^\/([a-zA-Z0-9_-]*)$/.exec(text);
  const slashList = slash ? skills.filter((s) => s.name.toLowerCase().includes(slash[1]!.toLowerCase())) : [];

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  // the draft and its uploads belong to the conversation they were typed in
  useEffect(() => {
    setText('');
    setAtts([]);
    setSlashIdx(0);
  }, [current?.id]);

  useEffect(() => {
    if (!quote || quote.conversationId !== current?.id) return;
    const block = quote.text.replace(/\r\n?/g, '\n').split('\n').map((line) => `> ${line}`).join('\n');
    setText((draft) => `${draft}${draft ? '\n\n' : ''}${block}\n\n`);
    const frame = requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(frame);
    // Each quote request is consumed once; conversation switches only clear drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  useEffect(() => {
    if (!starter) return;
    setText((draft) => `${draft}${draft ? '\n\n' : ''}${starter.text}`);
    ta.current?.focus();
  }, [starter]);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const res = await api.uploads.upload(files, current?.id);
      setAtts((a) => [...a, ...res]);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (running || uploading) return;
    if (!text.trim() && !atts.length) return;
    const t = text;
    const ids = atts.map((a) => a.id);
    setText('');
    setAtts([]);
    await send(t, ids);
    ta.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash && slashList.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx((i) => (i + 1) % slashList.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx((i) => (i - 1 + slashList.length) % slashList.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); setText(`/${slashList[slashIdx]!.name} `); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (files.length) { e.preventDefault(); void upload(files); }
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    void upload([...e.dataTransfer.files]);
  };

  const canSubmit = (text.trim().length > 0 || atts.length > 0) && !uploading;

  return (
    <div
      className="composer-wrap relative px-4 pb-4 pt-3"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="relative mx-auto max-w-3xl">
        {slash && <SlashMenu skills={skills} query={slash[1]!} active={slashIdx} onPick={(n) => { setText(`/${n} `); ta.current?.focus(); }} />}

        {/* Attachment preview list */}
        {atts.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-2">
            {atts.map((a) => (
              <div
                key={a.id}
                className="fade-in flex items-center gap-2 rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-1 pl-1.5 pr-2.5 text-xs shadow-xs"
              >
                {a.mime.startsWith('image/') ? (
                  <img src={a.url} className="h-8 w-8 rounded-lg object-cover ring-1 ring-zinc-200 dark:ring-zinc-700" alt="" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                    <Paperclip size={14} />
                  </div>
                )}
                <div className="flex flex-col">
                  <span className="max-w-40 truncate font-medium text-zinc-800 dark:text-zinc-200">{a.filename}</span>
                  <span className="text-[10px] text-zinc-400">{formatBytes(a.size)}</span>
                </div>
                <button
                  onClick={() => setAtts(atts.filter((x) => x.id !== a.id))}
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Floating composer container */}
        <div
          className={cn(
            'composer-surface relative rounded-2xl border transition-all duration-200',
            'border-zinc-200/90 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/95',
            'shadow-lg shadow-zinc-950/5 dark:shadow-black/25',
            'focus-within:border-accent-500/70 dark:focus-within:border-accent-500/70 focus-within:ring-3 focus-within:ring-accent-500/10',
            isDragging && 'border-accent-500 ring-2 ring-accent-500/20 bg-accent-50/10',
          )}
        >
          <textarea
            ref={ta}
            rows={1}
            value={text}
            onChange={(e) => { setText(e.target.value); setSlashIdx(0); }}
            onKeyDown={onKey}
            onPaste={onPaste}
            placeholder={model ? '输入你的问题，或按 / 调用技能…' : '请先在设置中添加供应商和模型'}
            aria-label="消息内容"
            className="max-h-60 w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-[15px] leading-6 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
          />

          {/* Bottom toolbar */}
          <div className="composer-toolbar flex flex-wrap items-center gap-2 px-3 pb-3 pt-1">
            {/* File upload button */}
            <button
              type="button"
              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 active:scale-95"
              title={attachTitle}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 size={16} className="animate-spin text-accent-500" /> : <Paperclip size={16} />}
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept={accept}
              onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ''; }}
            />

            {/* Reasoning Picker Capsule */}
            <WebSearchToggle />
            <ReasoningPicker />

            <div className="flex-1" />

            {/* Submit / Stop button */}
            {running ? (
              <button
                type="button"
                onClick={() => void stop()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-xs font-medium text-white dark:text-zinc-900 transition-all hover:bg-zinc-800 dark:hover:bg-white active:scale-95 shadow-xs"
                title="Stop generation"
              >
                <Square size={13} className="fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                className={cn(
                  'inline-flex items-center justify-center rounded-xl p-2 text-white shadow-xs transition-all duration-150',
                  canSubmit
                    ? 'bg-gradient-to-tr from-accent-600 to-accent-400 hover:from-accent-500 hover:to-accent-400 text-white shadow-sm shadow-accent-600/20 active:scale-95'
                    : 'bg-black/[0.04] dark:bg-white/[0.06] text-zinc-300 dark:text-zinc-600 cursor-not-allowed',
                )}
                title="Send (Enter)"
              >
                <Send size={17} />
              </button>
            )}
          </div>
        </div>

        {/* Keyboard hints */}
        <div className="mt-2 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
          <span><kbd className="font-mono">Enter</kbd> 发送</span>
          <span className="mx-1.5">·</span>
          <span><kbd className="font-mono">Shift+Enter</kbd> 换行</span>
          <span className="mx-1.5">·</span>
          <span><kbd className="font-mono text-zinc-500 dark:text-zinc-400">/name</kbd> 调用技能</span>
        </div>
      </div>
    </div>
  );
}
