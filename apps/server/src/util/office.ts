import path from 'node:path';
import { htmlToMarkdown } from './htmlToMarkdown.js';

/** Office Open XML extraction: .docx / .xlsx / .pptx → plain text for the model. */
export type OfficeKind = 'docx' | 'xlsx' | 'pptx';

const BY_EXT: Record<string, OfficeKind> = { '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx' };
const BY_MIME: Record<string, OfficeKind> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/** Extension wins: browsers often report these as application/octet-stream. */
export function officeKind(name: string, mime: string): OfficeKind | null {
  return BY_EXT[path.extname(name).toLowerCase()] ?? BY_MIME[mime] ?? null;
}

const MAX_CHARS = 200_000;

function clamp(text: string): string {
  return text.length <= MAX_CHARS ? text : `${text.slice(0, MAX_CHARS)}\n\n[truncated: extracted text exceeded ${MAX_CHARS} characters]`;
}

export async function officeText(buf: Buffer, kind: OfficeKind): Promise<string> {
  const text = kind === 'docx' ? await docxText(buf) : kind === 'xlsx' ? await xlsxText(buf) : await pptxText(buf);
  return clamp(text.trim());
}

async function docxText(buf: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  return htmlToMarkdown(value);
}

async function xlsxText(buf: Buffer): Promise<string> {
  const readXlsx = (await import('read-excel-file/node')).default;
  const sheets = await readXlsx(buf);
  return sheets
    .map(({ sheet, data }) => {
      const rows = data.map((row) => row.map(cellText).join('\t')).join('\n');
      return `## ${sheet}\n${rows || '(empty)'}`;
    })
    .join('\n\n');
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

async function pptxText(buf: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNo(a) - slideNo(b));
  const out: string[] = [];
  for (const name of slides) {
    const xml = await zip.files[name]!.async('string');
    // <a:t> holds every run of visible text; <a:p> boundaries become line breaks.
    const lines = xml
      .split(/<a:p[ >]/)
      .map((para) => [...para.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]!)).join(''))
      .map((s) => s.trim())
      .filter(Boolean);
    out.push(`## Slide ${slideNo(name)}\n${lines.join('\n') || '(no text)'}`);
  }
  return out.join('\n\n');
}

function slideNo(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}
