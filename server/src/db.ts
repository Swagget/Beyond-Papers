import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '..', '..');
const dataDir = process.env.DATA_DIR ?? path.join(rootDir, 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH ?? path.join(dataDir, 'beyond.db');

export const db: Database.Database = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = readFileSync(path.join(dirname, 'schema.sql'), 'utf8');
db.exec(schema);

/** now() used in tests / manual timestamps. */
export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
