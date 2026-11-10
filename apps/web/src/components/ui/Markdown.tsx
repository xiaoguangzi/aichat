import { memo, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../../lib/utils';
import { normalizeMath } from '../../lib/math';
import { CutTracker } from '../../lib/markdown-split.js';
import 'katex/dist/katex.min.css';

function Pre({ children }: { children?: ReactNode }) {
  const [ok, setOk] = useState(false);
  const extract = (n: ReactNode): string => {
    if (typeof n === 'string') return n;
    if (Array.isArray(n)) return n.map(extract).join('');
    if (n && typeof n === 'object' && 'props' in n) return extract((n as { props: { children?: ReactNode } }).props.children);
    return '';
  };
  return (
    <div className="group relative">
      <button
        onClick={async () => {
          if (await copyText(extract(children))) {
            setOk(true);
            setTimeout(() => setOk(false), 1200);
          }
        }}
        className="absolute right-2 top-2 rounded bg-zinc-700/70 p-1 text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
        title="Copy"
      >
        {ok ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre className="chat-code">{children}</pre>
    </div>
  );
}

type MdProps = React.ComponentProps<typeof ReactMarkdown>;
const remarkPlugins: MdProps['remarkPlugins'] = [remarkGfm, remarkMath];
const rehypePlugins: MdProps['rehypePlugins'] = [
  [rehypeHighlight, { ignoreMissing: true, detect: false }],
  // half-typed formulas are normal while streaming, so a parse error renders as tinted source
  // rather than throwing away the whole message
  [rehypeKatex, { errorColor: '#dc2626', strict: false, output: 'htmlAndMathml' }],
];
const components: MdProps['components'] = { pre: Pre };

/**
 * Parsing + highlighting is the dominant cost when a conversation mounts (every message is a
 * fresh element tree, so React's `memo` cannot help). React elements are immutable, so the
 * rendered tree can be reused across mounts — keyed by the source text, which is exactly what
 * makes re-opening a conversation cheap. Streaming text is excluded: every delta is a new key
 * and would just churn the cache.
 */
const cache = new Map<string, ReactNode>();
const CACHE_MAX = 400;

function render(text: string): ReactNode {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
      {text}
    </ReactMarkdown>
  );
}

function cached(text: string): ReactNode {
  const hit = cache.get(text);
  if (hit !== undefined) {
    // refresh LRU position
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  const body = render(normalizeMath(text));
  cache.set(text, body);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return body;
}

/** One independently parsed block of a streaming reply; a block that has stopped changing never re-renders. */
const Block = memo(function Block({ text }: { text: string }) {
  return useMemo(() => render(normalizeMath(text)), [text]);
});

/**
 * Streaming markdown: text is shown as it arrives. Settled blocks are parsed once and only the
 * tail is re-parsed as it grows.
 */
function LiveMarkdown({ text }: { text: string }) {
  const [tracker] = useState(() => new CutTracker());
  const bounds = [0, ...tracker.update(text), text.length];
  return (
    <div className="prose-chat">
      {bounds.slice(0, -1).map((start, index) => (
        <Block key={start} text={text.slice(start, bounds[index + 1]!)} />
      ))}
    </div>
  );
}

/**
 * `live` text is rendered block-wise while it streams. Once the stream ends the reply is
 * re-rendered whole from the cache: that is the canonical rendering, and the one every later
 * visit to the conversation shows.
 */
export const Markdown = memo(function Markdown({ text, live }: { text: string; live?: boolean }) {
  if (live) return <LiveMarkdown text={text} />;
  return <div className="prose-chat">{cached(text)}</div>;
});
