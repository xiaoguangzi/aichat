import { useState } from 'react';
import type { ToolResultBlock, ToolUseBlock } from '@aichat/shared';
import { AlertTriangle, Check, ChevronDown, Copy, Loader2, Terminal, Wrench } from 'lucide-react';
import { cn, copyText } from '../../lib/utils';

export function ToolCallCard({ call, result }: { call: ToolUseBlock; result?: ToolResultBlock }) {
  const [open, setOpen] = useState(false);
  const [copiedInput, setCopiedInput] = useState(false);
  const [copiedResult, setCopiedResult] = useState(false);

  const pending = !result;
  const isError = result?.is_error === true;
  const isMcp = call.name.startsWith('mcp__');

  const resultText = result?.content
    .map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? `[image ${b.mime}]` : `[${b.type}]`))
    .join('\n');
  const images = result?.content.filter((b) => b.type === 'image' && b.data) ?? [];

  return (
    <div
      className={cn(
        'card my-2.5 overflow-hidden text-sm transition-all duration-150',
        isError ? 'border-red-300 dark:border-red-900/80' : 'border-zinc-200/80 dark:border-zinc-800/80',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 bg-zinc-50/90 dark:bg-zinc-900/80 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-zinc-100/90 dark:hover:bg-zinc-800/60"
      >
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500">
          {isMcp ? <Wrench size={12} /> : <Terminal size={12} />}
        </div>
        <div className="flex items-center gap-1.5 truncate">
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-200/60 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            {isMcp ? 'MCP' : 'Tool'}
          </span>
          <span className="truncate font-mono font-medium text-zinc-800 dark:text-zinc-200">{call.name}</span>
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-zinc-400">
          {result?.durationMs != null && (
            <span className="tabular-nums text-[11px] text-zinc-400">{(result.durationMs / 1000).toFixed(1)}s</span>
          )}
          {pending ? (
            <span className="flex items-center gap-1 text-accent-500 font-medium">
              <Loader2 size={12} className="animate-spin" />
              <span>Running</span>
            </span>
          ) : isError ? (
            <span className="flex items-center gap-1 text-red-500 font-medium">
              <AlertTriangle size={12} />
              <span>Failed</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-accent-600 dark:text-accent-400 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
              <span>Done</span>
            </span>
          )}
          <ChevronDown
            size={13}
            className={cn('text-zinc-400 transition-transform duration-150', open && 'rotate-180')}
          />
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-100 dark:border-zinc-800/90 bg-white dark:bg-zinc-950/40 text-xs">
          {/* Input section */}
          <div className="p-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              <span>Input</span>
              <button
                type="button"
                onClick={async () => {
                  if (await copyText(JSON.stringify(call.input, null, 2))) {
                    setCopiedInput(true);
                    setTimeout(() => setCopiedInput(false), 1200);
                  }
                }}
                className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                {copiedInput ? <Check size={11} className="text-accent-600 dark:text-accent-400" /> : <Copy size={11} />}
                <span>{copiedInput ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="max-h-60 overflow-auto rounded-xl bg-zinc-50 dark:bg-zinc-900 p-2.5 font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-all ring-1 ring-zinc-200/60 dark:ring-zinc-800">
              {call.input == null ? '…' : JSON.stringify(call.input, null, 2)}
            </pre>
          </div>

          {/* Result section */}
          {result && (
            <div className="border-t border-zinc-100 dark:border-zinc-800/80 p-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                <span className={cn(isError && 'text-red-500 font-semibold')}>
                  {isError ? 'Error Result' : 'Output Result'}
                </span>
                {resultText && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (await copyText(resultText)) {
                        setCopiedResult(true);
                        setTimeout(() => setCopiedResult(false), 1200);
                      }
                    }}
                    className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  >
                    {copiedResult ? <Check size={11} className="text-accent-600 dark:text-accent-400" /> : <Copy size={11} />}
                    <span>{copiedResult ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
              <pre
                className={cn(
                  'max-h-80 overflow-auto rounded-xl p-2.5 font-mono whitespace-pre-wrap break-all ring-1',
                  isError
                    ? 'bg-red-50/50 dark:bg-red-950/20 text-red-600 dark:text-red-400 ring-red-200 dark:ring-red-900/50'
                    : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 ring-zinc-200/60 dark:ring-zinc-800',
                )}
              >
                {resultText}
              </pre>
              {images.map((im, i) => im.type === 'image' && (
                <img
                  key={i}
                  src={`data:${im.mime};base64,${im.data}`}
                  className="mt-3 max-h-64 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800"
                  alt="tool result"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
