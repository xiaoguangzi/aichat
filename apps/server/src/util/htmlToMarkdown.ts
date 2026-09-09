/**
 * Narrow HTML → Markdown converter for mammoth's docx output.
 *
 * Mammoth emits a small, fixed tag vocabulary (headings, p, ul/ol/li, table/tr/td,
 * strong/em, a, br, blockquote, sup/sub, pre). This walks that vocabulary linearly
 * rather than parsing generic HTML; unknown tags fall through to their text content
 * so nothing is silently dropped.
 */
const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*?)\/?>/g;

export function htmlToMarkdown(html: string): string {
  const out: string[] = [];
  const listStack: { ordered: boolean; index: number }[] = [];
  let table: string[][] | null = null;
  let row: string[] | null = null;
  let sink: string[] = out; // where text lands: the document, or the current table cell
  let cell: string[] | null = null;
  let href: string | null = null;

  const push = (s: string) => sink.push(s);
  const block = (s: string) => {
    if (!cell) out.push(s);
  };

  let last = 0;
  for (const m of html.matchAll(TOKEN)) {
    const text = html.slice(last, m.index);
    last = m.index + m[0]!.length;
    if (text) push(decodeEntities(text));

    const closing = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    const attrs = m[3] ?? '';

    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        block(closing ? '\n\n' : `\n\n${'#'.repeat(Number(tag[1]))} `);
        break;
      case 'p':
        if (closing) push(cell ? ' ' : '\n\n');
        break;
      case 'br':
        push(cell ? ' ' : '\n');
        break;
      case 'ul': case 'ol':
        if (closing) listStack.pop();
        else listStack.push({ ordered: tag === 'ol', index: 0 });
        if (closing && !listStack.length) block('\n');
        break;
      case 'li': {
        const top = listStack[listStack.length - 1];
        if (!closing && top) {
          top.index += 1;
          const marker = top.ordered ? `${top.index}. ` : '- ';
          block(`\n${'  '.repeat(listStack.length - 1)}${marker}`);
        }
        break;
      }
      case 'strong': case 'b':
        push('**');
        break;
      case 'em': case 'i':
        push('*');
        break;
      case 'a':
        if (closing) {
          push(href ? `](${href})` : '');
          href = null;
        } else {
          href = attr(attrs, 'href');
          if (href) push('[');
        }
        break;
      case 'img': {
        const alt = attr(attrs, 'alt');
        push(`[image${alt ? `: ${alt}` : ''}]`);
        break;
      }
      case 'blockquote':
        block(closing ? '\n\n' : '\n\n> ');
        break;
      case 'table':
        if (closing) {
          if (table?.length) out.push(`\n\n${renderTable(table)}\n\n`);
          table = null;
        } else {
          table = [];
        }
        break;
      case 'tr':
        if (closing) {
          if (row && table) table.push(row);
          row = null;
        } else {
          row = [];
        }
        break;
      case 'td': case 'th':
        if (closing) {
          if (cell && row) row.push(cell.join('').replace(/\s+/g, ' ').trim());
          cell = null;
          sink = out;
        } else {
          cell = [];
          sink = cell;
        }
        break;
      default:
        break; // unknown tag: contents already flow through as text
    }
  }
  if (last < html.length) push(decodeEntities(html.slice(last)));

  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderTable(rows: string[][]): string {
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
  const [head, ...body] = rows;
  return [line(head!), `| ${Array(width).fill('---').join(' | ')} |`, ...body.map(line)].join('\n');
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}
