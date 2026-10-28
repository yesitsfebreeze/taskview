import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
export const home = () => process.env.CODEX_HOME || join(process.env.HOME!, '.codex');
export function db() {
  const dir = join(home(), 'taskview'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const d = new Database(join(dir, 'state.sqlite'), { create: true });
  d.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  return d;
}
export function get(d: Database, key: string, fallback: any = null) {
  const row = d.query('SELECT value FROM state WHERE key=?').get(key) as any;
  return row ? JSON.parse(row.value) : fallback;
}
export function put(d: Database, key: string, value: any) {
  d.query('INSERT OR REPLACE INTO state VALUES (?,?)').run(key, JSON.stringify(value));
}
export function mutate<T>(key: string, fallback: any, fn: (value: any) => T): T {
  const d = db();
  try { return d.transaction(() => { const value = get(d, key, fallback); const result = fn(value); put(d, key, value); return result; }).immediate(); }
  finally { d.close(); }
}
export function read(key: string, fallback: any) { const d = db(); try { return get(d, key, fallback); } finally { d.close(); } }
export function id(s: any) { if (typeof s !== 'string' || !/^[\w.-]{1,180}$/.test(s)) throw Error('Invalid session id'); return s; }
export const repoKey = (cwd: string) => 'repo:' + resolve(cwd);
