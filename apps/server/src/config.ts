import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Default data/skills/web paths are relative to the repository root, regardless of cwd
// (dev runs with cwd=apps/server, `npm start` runs from the root). src/config.ts and the
// bundled dist/index.js are both three levels below the root.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const resolve = (p: string) => path.resolve(process.cwd(), p);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** Bind address. Default 127.0.0.1 (IPv4 loopback only); set HOST=0.0.0.0 to expose on the LAN. */
  host: process.env.HOST || '127.0.0.1',
  dataDir: process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : path.join(repoRoot, 'data'),
  skillsDir: process.env.SKILLS_DIR ? resolve(process.env.SKILLS_DIR) : path.join(repoRoot, 'skills'),
  /** Static web build directory (production) */
  webDist: process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : path.join(repoRoot, 'apps/web/dist'),
  maxUploadBytes: 20 * 1024 * 1024,
  maxAgentIterations: 25,
  toolTimeoutMs: 60_000,
  scriptTimeoutMs: 30_000,
  toolResultPreviewChars: 8_000,
  toolResultBatchChars: 16_000,
  toolResultMinChars: 1_200,
  /** Batch-compaction watermarks for replayable tool text and Anthropic thinking (UTF-16 chars). */
  historyHighWaterChars: 48_000,
  historyLowWaterChars: 16_000,
  /** Small results survive compaction; larger originals remain readable from local storage. */
  toolResultHistoryKeepChars: 1_200,
};

export const uploadsDir = path.join(config.dataDir, 'uploads');
export const dbPath = path.join(config.dataDir, 'aichat.db');

export function ensureDirs() {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(config.skillsDir, { recursive: true });
}
