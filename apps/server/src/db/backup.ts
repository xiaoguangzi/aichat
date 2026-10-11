import type { BackupInfo } from '@aichat/shared';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './database.js';
import { config, dbPath } from '../config.js';

const backupsDir = path.join(config.dataDir, 'backups');
/** Enough history to cover a mistake noticed a few days later, without unbounded growth. */
const MAX_BACKUPS = 10;
const NAME_RE = /^aichat-(\d{4}-\d{2}-\d{2}T[\d-]+Z)(?:-(\d+))?\.db$/;

const stamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-');

/** Two snapshots inside the same millisecond must not collide: VACUUM INTO refuses to overwrite. */
function uniqueName(): string {
  const base = `aichat-${stamp()}`;
  let name = `${base}.db`;
  for (let n = 2; fs.existsSync(path.join(backupsDir, name)); n += 1) name = `${base}-${n}.db`;
  return name;
}

function list(): BackupInfo[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(backupsDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => NAME_RE.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(backupsDir, name));
      return { name, bytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Online snapshot of the whole database.
 *
 * `VACUUM INTO` is what makes this safe while the server keeps running: it writes a consistent copy
 * through SQLite itself, so there is no window where a half-written page can be captured, and it
 * compacts as it goes. Copying the .db file by hand does not have that guarantee in WAL mode — the
 * newest committed data may still be in the -wal file.
 */
export function createBackup(): BackupInfo {
  fs.mkdirSync(backupsDir, { recursive: true });
  const name = uniqueName();
  const target = path.join(backupsDir, name);
  // The path is embedded in SQL, so quote it; backupsDir comes from config, not user input.
  getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  // Uploads are not part of the database; the snapshot is only useful with a note about them.
  fs.writeFileSync(
    path.join(backupsDir, 'README.txt'),
    [
      'aichat 数据库快照',
      '',
      '每个 aichat-*.db 都是某个时刻的完整数据库（会话、消息、工具结果原文、配置与密钥）。',
      '恢复：停止服务，把选定的快照复制到数据目录并改名为 aichat.db（先备份当前文件），',
      '然后启动服务。数据库会自动跑迁移。',
      '',
      `上传的附件不在快照里，位于：${path.join(config.dataDir, 'uploads')}`,
      '需要连附件一起备份时，停止服务后复制整个数据目录。',
      '',
    ].join('\n'),
    'utf8',
  );
  prune();
  return list().find((b) => b.name === name)!;
}

/** Keep only the newest few; a backup directory that grows forever is its own problem. */
function prune(): number {
  const all = list();
  let removed = 0;
  for (const old of all.slice(MAX_BACKUPS)) {
    try {
      fs.unlinkSync(path.join(backupsDir, old.name));
      removed += 1;
    } catch {
      // A file that cannot be removed is reported by still being listed next time.
    }
  }
  return removed;
}

export function backupList(): { dir: string; max: number; dbBytes: number; backups: BackupInfo[] } {
  let dbBytes = 0;
  try {
    dbBytes = fs.statSync(dbPath).size;
  } catch {
    dbBytes = 0;
  }
  return { dir: backupsDir, max: MAX_BACKUPS, dbBytes, backups: list() };
}
