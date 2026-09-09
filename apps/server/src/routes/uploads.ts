import { Hono } from 'hono';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { attachmentsRepo } from '../db/repos/attachments.js';
import { uploadsDir, config } from '../config.js';
import { uuid } from '../util/id.js';
import { badRequest, notFound } from '../util/errors.js';

export const uploadsRoute = new Hono();

uploadsRoute.post('/', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const raw = body['file'] ?? body['files'];
  const files = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File);
  if (!files.length) throw badRequest('no file');
  const conversationId = typeof body['conversationId'] === 'string' ? body['conversationId'] : null;
  const out = [];
  for (const f of files) {
    if (f.size > config.maxUploadBytes) throw badRequest(`file too large: ${f.name}`);
    const id = uuid();
    const ext = path.extname(f.name).slice(0, 10);
    const dest = path.join(uploadsDir, `${id}${ext}`);
    await fs.writeFile(dest, Buffer.from(await f.arrayBuffer()));
    const rec = attachmentsRepo.create({ id, conversationId, filename: f.name, mime: f.type || 'application/octet-stream', size: f.size, path: dest });
    const { path: _p, ...pub } = rec;
    out.push(pub);
  }
  return c.json(out, 201);
});

uploadsRoute.get('/:id', async (c) => {
  const att = attachmentsRepo.get(c.req.param('id'));
  if (!att) throw notFound('attachment');
  const stream = Readable.toWeb(createReadStream(att.path)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      'Content-Type': att.mime,
      'Content-Length': String(att.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      'Cache-Control': 'private, max-age=86400',
    },
  });
});
