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

// Lightweight additive migrations. schema.sql is idempotent for *new* tables/indexes, but
// `CREATE TABLE IF NOT EXISTS` does not add columns to a table that already exists — so a
// new column on an existing table needs an explicit, idempotent ADD COLUMN here.
function addColumnIfMissing(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
addColumnIfMissing('chats', 'ai_consent', "ai_consent INTEGER NOT NULL DEFAULT 0 CHECK (ai_consent IN (0,1))");

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
