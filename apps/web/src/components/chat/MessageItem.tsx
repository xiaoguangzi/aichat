import { memo, useState } from 'react';
import type { Message, ToolResultBlock, Usage } from '@aichat/shared';
import { Check, Copy, Pencil, RefreshCw, FileText, AlertCircle } from 'lucide-react';
import { ArtifactMessage } from '../artifacts/ArtifactMessage.js';
import { ImagePreview } from './ImagePreview.js';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallCard } from './ToolCallCard';
import { PendingIndicator } from './PendingIndicator';
import { Button } from '../ui/Button';
import { cn, copyText } from '../../lib/utils';
import { usageLabel } from '../../lib/usage';

interface Props {
  message: Message;
  streaming?: boolean;
  results: Record<string, ToolResultBlock>;
  onRegenerate?: () => void;
  onEdit?: (messageId: string, text: string) => void;
  isLastAssistant?: boolean;
  /** The turn-level disclosure renders thinking and tools together. */
  hideProcess?: boolean;
  /** false on the non-final messages of a multi-step assistant turn (see MessageList) */
  showFooter?: boolean;
  /** turn totals, shown on the message that closes a multi-step assistant turn */
  footerUsage?: Usage | null;
  /** text of the whole turn, so Copy on a multi-step turn yields the whole reply */
  footerText?: string;
}

export const MessageItem = memo(function MessageItem({ message, streaming, results, onRegenerate, onEdit, isLastAssistant, hideProcess, showFooter = true, footerUsage, footerText }: Props) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const isUser = message.role === 'user';
  const plain = message.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');

  if (isUser) {
    const atts = message.content.filter((b) => b.type === 'image' || b.type === 'document');
    return (
      <div className="group flex justify-end">
        <div className="max-w-[85%] sm:max-w-[80%]">
          {atts.length > 0 && (
            <div className="mb-1.5 flex flex-wrap justify-end gap-2">
              {atts.map((b, i) =>
                b.type === 'image' ? (
                  <ImagePreview
                    key={i}
                    src={b.attachmentId ? `/api/uploads/${b.attachmentId}` : `data:${b.mime};base64,${b.data}`}
                  />
                ) : (
                  <a
                    key={i}
                    href={b.type === 'document' && b.attachmentId ? `/api/uploads/${b.attachmentId}` : '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800/90 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 shadow-2xs hover:bg-zinc-200/80 transition-colors"
                  >
                    <FileText size={14} className="text-zinc-400" />
                    <span className="font-medium">{b.type === 'document' ? b.name || 'attachment' : ''}</span>
                  </a>
                ),
              )}
            </div>
          )}
          {editing ? (
            <div className="rounded-2xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 shadow-md">
              <textarea
                className="w-full resize-y bg-transparent p-1 text-[15px] leading-6 focus:outline-none"
                rows={4}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" variant="primary" onClick={() => { setEditing(false); onEdit?.(message.id, draft); }}>Send</Button>
              </div>
            </div>
          ) : (
            plain && (
              <div className="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent-100 dark:bg-[#1a293c] px-4 py-2.5 text-[15px] leading-7 text-accent-950 dark:text-[#dce9f8] shadow-2xs break-words selection:bg-accent-200 selection:text-accent-950 dark:selection:bg-accent-800 dark:selection:text-accent-100">
                {plain}
              </div>
            )
          )}
          <div className="mt-1 flex items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <IconBtn title="Copy" onClick={async () => { if (await copyText(plain)) { setCopied(true); setTimeout(() => setCopied(false), 1200); } }}>
              {copied ? <Check size={13} className="text-accent-600 dark:text-accent-400" /> : <Copy size={13} />}
            </IconBtn>
            {onEdit && (
              <IconBtn title="Edit & resend" onClick={() => { setDraft(plain); setEditing(true); }}>
                <Pencil size={13} />
              </IconBtn>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group">
      <div className="max-w-full">
        {message.content.map((b, i) => {
          switch (b.type) {
            case 'thinking':
              return hideProcess ? null : <ThinkingBlock key={i} text={b.thinking} streaming={!!streaming && i === message.content.length - 1} />;
            case 'text': {
              const live = !!streaming && i === message.content.length - 1;
              return (
                <div key={i} className={cn(live && 'cursor-blink')}>
                  <ArtifactMessage text={b.text} live={live} messageId={message.id} block={i} />
                </div>
              );
            }
            case 'tool_use':
              return hideProcess ? null : <ToolCallCard key={b.id} call={b} result={results[b.id]} />;
            default:
              return null;
          }
        })}
        {streaming && message.content.length === 0 && <PendingIndicator since={Date.parse(message.createdAt)} />}
        {message.stopReason === 'interrupted' && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent-50 dark:bg-accent-950/30 px-2 py-1 text-xs text-accent-700 dark:text-accent-300">
            <AlertCircle size={13} /> Interrupted
          </div>
        )}
        {message.stopReason === 'max_tokens' && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent-50 dark:bg-accent-950/30 px-2 py-1 text-xs text-accent-700 dark:text-accent-300">
            <AlertCircle size={13} /> Output hit max_tokens
          </div>
        )}
        {message.stopReason === 'error' && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 px-2 py-1 text-xs text-red-700 dark:text-red-400">
            <AlertCircle size={13} /> Error (partial output)
          </div>
        )}
        {!streaming && showFooter && (
          <div className="mt-2 flex items-center gap-1 text-xs text-zinc-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <IconBtn title="Copy" onClick={async () => { if (await copyText(footerText ?? plain)) { setCopied(true); setTimeout(() => setCopied(false), 1200); } }}>
              {copied ? <Check size={13} className="text-accent-600 dark:text-accent-400" /> : <Copy size={13} />}
            </IconBtn>
            {isLastAssistant && onRegenerate && (
              <IconBtn title="Regenerate" onClick={onRegenerate}>
                <RefreshCw size={13} />
              </IconBtn>
            )}
            {(footerUsage ?? message.usage) && (
              <span title="输入↑ / 输出↓ tokens。≥ 表示统计不完整，仅为已知下限；缓存未报告不等于未命中。旧记录保留当时接口的输入口径。" className="ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-zinc-400 bg-zinc-100 dark:bg-zinc-800/80">
                {usageLabel((footerUsage ?? message.usage)!)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function IconBtn({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 active:scale-95"
      {...p}
    >
      {children}
    </button>
  );
}
