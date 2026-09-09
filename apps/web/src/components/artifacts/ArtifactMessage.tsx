import { useMemo } from 'react';
import { parseArtifacts } from '@aichat/shared';
import { FileCode2, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { Markdown } from '../ui/Markdown.js';
import { useArtifacts } from './ArtifactWorkspace.js';

export function ArtifactMessage({ text, messageId, block, live }: { text: string; messageId: string; block: number; live: boolean }) {
  const { open } = useArtifacts();
  const artifacts = useMemo(() => parseArtifacts(text), [text]);
  if (!artifacts.length) return <div data-quote-text><Markdown text={text} live={live} /></div>;
  let cursor = 0;
  const parts = artifacts.map((artifact, index) => {
    const before = text.slice(cursor, artifact.start);
    cursor = artifact.end;
    return <div key={index}>
      {before.trim() && <div data-quote-text><Markdown text={before} live={live} /></div>}
      <button type="button" onClick={() => open(`${messageId}:${block}:${index}`)}
        className="my-3 flex w-full max-w-md items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-left transition-colors hover:border-accent-400 hover:bg-accent-500/5 dark:border-zinc-700 dark:bg-zinc-900">
        <span className="rounded-lg border border-zinc-200 bg-white p-2.5 text-accent-500 dark:border-zinc-700 dark:bg-zinc-800"><FileCode2 size={22} /></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{artifact.title}</span>
          <span className="mt-1 flex items-center gap-1 text-xs text-zinc-500">{!artifact.complete && <LoaderCircle size={12} className="animate-spin" />}{artifact.complete ? `${artifact.language.toUpperCase()} · 点击打开作品` : live ? '正在生成…' : '内容不完整 · 查看源码'}</span></span>
        <ArrowUpRight size={16} className="text-zinc-400" />
      </button>
    </div>;
  });
  return <>{parts}{text.slice(cursor).trim() && <div data-quote-text><Markdown text={text.slice(cursor)} live={live} /></div>}</>;
}
