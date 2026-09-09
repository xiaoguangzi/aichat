import { getDb, j } from '../database.js';

export const settingsRepo = {
  get<T>(key: string, fallback: T): T {
    const r = getDb().prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined;
    return r ? j.parse<T>(r.value_json, fallback) : fallback;
  },
  set(key: string, value: unknown) {
    getDb().prepare('INSERT OR REPLACE INTO settings(key, value_json) VALUES (?, ?)').run(key, j.str(value));
  },
};
