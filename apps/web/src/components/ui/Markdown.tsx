import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../../lib/utils';
import { normalizeMath } from '../../lib/math';
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
      <pre className="bg-[#0d1117] text-zinc-100">{children}</pre>
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
      {normalizeMath(text)}
    </ReactMarkdown>
  );
}

export const Markdown = memo(function Markdown({ text, live }: { text: string; live?: boolean }) {
  let body: ReactNode;
  if (live) {
    body = render(text);
  } else {
    const hit = cache.get(text);
    if (hit !== undefined) {
      // refresh LRU position
      cache.delete(text);
      cache.set(text, hit);
      body = hit;
    } else {
      body = render(text);
      cache.set(text, body);
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
  }
  return <div className="prose-chat">{body}</div>;
});
