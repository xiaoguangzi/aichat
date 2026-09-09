import fs from 'node:fs/promises';
import path from 'node:path';
import type { Block, ProviderType } from '@aichat/shared';
import { attachmentsRepo } from '../db/repos/attachments.js';
import { officeKind, officeText } from './office.js';

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.toml', '.ini', '.log', '.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.sh', '.sql', '.html', '.css', '.scss', '.vue', '.svelte']);

export function isImageMime(m: string) {
  return IMAGE_MIMES.has(m);
}
export function isTextFile(name: string, mime: string) {
  return mime.startsWith('text/') || TEXT_EXT.has(path.extname(name).toLowerCase());
}

const cache = new Map<string, string>();

async function readImageBase64(file: string): Promise<string> {
  const hit = cache.get(file);
  if (hit) return hit;
  let buf = await fs.readFile(file);
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buf).metadata();
    if ((meta.width ?? 0) > 1568 || (meta.height ?? 0) > 1568) {
      buf = await sharp(buf).resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).toBuffer();
    }
  } catch {
    /* sharp unavailable — send original */
  }
  const b64 = buf.toString('base64');
  if (cache.size > 50) cache.clear();
  cache.set(file, b64);
  return b64;
}

async function pdfText(buf: Buffer): Promise<string> {
  const mod = (await import('pdf-parse')) as unknown as { PDFParse?: new (o: { data: Buffer }) => { getText(): Promise<{ text: string }>; destroy(): Promise<void> } };
  if (mod.PDFParse) {
    const p = new mod.PDFParse({ data: buf });
    try {
      const r = await p.getText();
      return r.text;
    } finally {
      await p.destroy();
    }
  }
  throw new Error('pdf-parse unavailable');
}

/** Convert an uploaded attachment into canonical block(s) (stored by reference for images/pdf). */
export function attachmentToBlocks(att: { id: string; filename: string; mime: string }): Block[] {
  if (isImageMime(att.mime)) return [{ type: 'image', mime: att.mime, attachmentId: att.id }];
  if (att.mime === 'application/pdf') return [{ type: 'document', mime: att.mime, name: att.filename, attachmentId: att.id }];
  return [{ type: 'document', mime: att.mime || 'text/plain', name: att.filename, attachmentId: att.id }];
}

/**
 * Replace attachment references with inline data before sending to a provider.
 * PDFs become native documents for Anthropic; extracted text for OpenAI-compatible endpoints.
 * Office files (.docx/.xlsx/.pptx) are always extracted to text — no provider takes them natively.
 */
export async function hydrateBlocks(blocks: Block[], providerType: ProviderType): Promise<Block[]> {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.type === 'image' && b.attachmentId && !b.data) {
      const att = attachmentsRepo.get(b.attachmentId);
      if (!att) {
        out.push({ type: 'text', text: `[missing image attachment]` });
        continue;
      }
      out.push({ type: 'image', mime: att.mime, data: await readImageBase64(att.path) });
    } else if (b.type === 'document' && b.attachmentId && !b.data) {
      const att = attachmentsRepo.get(b.attachmentId);
      if (!att) {
        out.push({ type: 'text', text: `[missing attachment ${b.name}]` });
        continue;
      }
      const buf = await fs.readFile(att.path);
      const office = officeKind(att.filename, att.mime);
      if (att.mime === 'application/pdf') {
        if (providerType === 'anthropic') {
          out.push({ type: 'document', mime: 'application/pdf', name: att.filename, data: buf.toString('base64') });
        } else {
          let text: string;
          try {
            text = await pdfText(buf);
          } catch (e) {
            text = `[could not extract PDF text: ${e instanceof Error ? e.message : String(e)}]`;
          }
          out.push({ type: 'text', text: `<file name="${att.filename}">\n${text}\n</file>` });
        }
      } else if (office) {
        let text: string;
        try {
          text = await officeText(buf, office);
        } catch (e) {
          text = `[could not extract ${office} text: ${e instanceof Error ? e.message : String(e)}]`;
        }
        out.push({ type: 'text', text: `<file name="${att.filename}">\n${text}\n</file>` });
      } else if (isTextFile(att.filename, att.mime)) {
        out.push({ type: 'text', text: `<file name="${att.filename}">\n${buf.toString('utf8')}\n</file>` });
      } else {
        out.push({ type: 'text', text: `[attachment ${att.filename} (${att.mime}, ${att.size} bytes) — binary content not included]` });
      }
    } else if (b.type === 'tool_result') {
      out.push({ ...b, content: await hydrateBlocks(b.content, providerType) });
    } else {
      out.push(b);
    }
  }
  return out;
}
