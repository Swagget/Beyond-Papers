import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '..', '..');

const dbPath = process.env.DB_PATH ?? path.join(rootDir, 'data', 'beyond.db');
mkdirSync(path.dirname(dbPath), { recursive: true });

export const db: Database.Database = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON'); // must run every process start — not persisted by SQLite

const schema = readFileSync(path.join(dirname, 'schema.sql'), 'utf8');
db.exec(schema);

export function nowIso(): string {
  return new Date().toISOString();
}

export function runInTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}

/** Repoint works.current_version_id and touch updated_at. The old version row is never mutated (§1.3). */
export function setCurrentVersion(workId: number, versionId: number): void {
  db.prepare(
    `UPDATE works SET current_version_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
  ).run(versionId, workId);
}
