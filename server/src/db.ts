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

// One-time rebuild of `works` for DBs created before the 'blog' kind existed.
// CREATE TABLE IF NOT EXISTS never updates an existing table's CHECK constraints, so widening
// the kind/source enums (and adding url/url_normalized/site_name/publication_status) requires
// the standard SQLite 12-step rebuild. Row ids are copied explicitly so the external-content
// works_fts index and every FK stay valid. Detected via the live DDL in sqlite_master.
// MUST run before the schema exec below: schema.sql now indexes works(publication_status),
// which errors on a legacy table that doesn't have the column yet.
function rebuildWorksIfLegacy(): void {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='works'`).get() as
    | { sql: string }
    | undefined;
  if (!row || row.sql.includes(`'blog'`)) return;

  console.log('[db] migrating works table: widening kind/source enums, adding url/publication_status');
  db.pragma('foreign_keys = OFF'); // must happen outside any transaction
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE works_new (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          kind               TEXT NOT NULL CHECK (kind IN ('paper','review','replication','concept','dataset','code','blog')),
          result_nature      TEXT NOT NULL DEFAULT 'na' CHECK (result_nature IN ('positive','negative','null','inconclusive','na')),
          editing            TEXT NOT NULL DEFAULT 'authored' CHECK (editing IN ('authored','communal')),
          title              TEXT NOT NULL,
          abstract           TEXT,
          doi                TEXT UNIQUE,
          arxiv_id           TEXT UNIQUE,
          openalex_id        TEXT UNIQUE,
          url                TEXT,
          url_normalized     TEXT UNIQUE,
          site_name          TEXT,
          source             TEXT NOT NULL DEFAULT 'native' CHECK (source IN ('native','openalex','crossref','arxiv','pubmed','web')),
          license            TEXT NOT NULL DEFAULT 'unknown' CHECK (license IN (
                                'cc-by','cc-by-sa','cc0','public-domain','platform-cc-by-sa',
                                'cc-by-nd',
                                'arxiv-default','cc-by-nc','cc-by-nc-sa','cc-by-nc-nd','closed','unknown'
                              )),
          tier               TEXT NOT NULL DEFAULT 'A' CHECK (tier IN ('A','B','C')),
          publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('published','preprint','informal')),
          publication_year   INTEGER,
          current_version_id INTEGER REFERENCES work_versions(id),
          created_by         INTEGER REFERENCES users(id),
          created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          CHECK (kind != 'concept' OR editing = 'communal')
        );
        INSERT INTO works_new (
          id, kind, result_nature, editing, title, abstract, doi, arxiv_id, openalex_id,
          url, url_normalized, site_name, source, license, tier, publication_status,
          publication_year, current_version_id, created_by, created_at, updated_at
        )
        SELECT
          id, kind, result_nature, editing, title, abstract, doi, arxiv_id, openalex_id,
          NULL, NULL, NULL, source, license, tier,
          CASE source WHEN 'arxiv' THEN 'preprint' WHEN 'native' THEN 'informal' ELSE 'published' END,
          publication_year, current_version_id, created_by, created_at, updated_at
        FROM works;
        DROP TABLE works;
        ALTER TABLE works_new RENAME TO works;
      `);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
  if (fkViolations.length > 0) {
    throw new Error(`works table migration left foreign key violations: ${JSON.stringify(fkViolations.slice(0, 5))}`);
  }
  // The idx_works_* indexes and works_fts_* triggers dropped with the old table are
  // recreated by the schema exec that follows.
}
rebuildWorksIfLegacy();
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
