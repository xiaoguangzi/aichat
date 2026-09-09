import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbPath } from '../config.js';

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) throw new Error('database not initialised');
  return db;
}

export function initDb(file: string = dbPath): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  runMigrations(db);
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}

function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src layout: src/db/migrations ; bundled layout: dist/db/migrations (next to dist/index.js)
  for (const c of [path.join(here, 'migrations'), path.join(here, 'db', 'migrations')]) if (fs.existsSync(c)) return c;
  throw new Error('migrations directory not found');
}

function runMigrations(d: DatabaseSync) {
  d.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)');
  const row = d.prepare("SELECT value_json FROM settings WHERE key = 'schema_version'").get() as
    | { value_json: string }
    | undefined;
  let version = row ? (JSON.parse(row.value_json) as number) : 0;
  const files = fs
    .readdirSync(migrationsDir())
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  for (const f of files) {
    const n = Number(f.split('_')[0]);
    if (n <= version) continue;
    const sql = fs.readFileSync(path.join(migrationsDir(), f), 'utf8');
    d.exec('BEGIN');
    try {
      d.exec(sql);
      d.prepare("INSERT OR REPLACE INTO settings(key, value_json) VALUES ('schema_version', ?)").run(JSON.stringify(n));
      d.exec('COMMIT');
      version = n;
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
  }
}

export const j = {
  parse<T>(s: string | null | undefined, fallback: T): T {
    if (!s) return fallback;
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  },
  str(v: unknown): string {
    return JSON.stringify(v ?? null);
  },
};
