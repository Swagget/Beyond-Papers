-- Beyond Papers — SQLite schema. Idempotent (IF NOT EXISTS everywhere).
-- Enum values must match shared/types.ts; structure per docs/ARCHITECTURE.md §3.

-- ============================================================
-- USERS & AUTH
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,               -- "scrypt:<N>:<r>:<p>:<saltHex>:<hashHex>"
  display_name  TEXT NOT NULL,
  is_pseudonym  INTEGER NOT NULL DEFAULT 0 CHECK (is_pseudonym IN (0,1)),
  orcid         TEXT UNIQUE,                 -- ####-####-####-###[#X], nullable, format-validated in app
  bio           TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,               -- crypto.randomBytes(32).toString('hex')
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ============================================================
-- WORKS (nodes) & VERSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS works (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  kind               TEXT NOT NULL CHECK (kind IN ('paper','review','replication','concept','dataset','code')),
  result_nature      TEXT NOT NULL DEFAULT 'na' CHECK (result_nature IN ('positive','negative','null','inconclusive','na')),
  editing            TEXT NOT NULL DEFAULT 'authored' CHECK (editing IN ('authored','communal')),
  title              TEXT NOT NULL,
  abstract           TEXT,
  doi                TEXT UNIQUE,
  arxiv_id           TEXT UNIQUE,             -- base id, no version suffix, e.g. "2301.12345"
  openalex_id        TEXT UNIQUE,
  source             TEXT NOT NULL DEFAULT 'native' CHECK (source IN ('native','openalex','crossref','arxiv','pubmed')),
  license            TEXT NOT NULL DEFAULT 'unknown' CHECK (license IN (
                        'cc-by','cc-by-sa','cc0','public-domain','platform-cc-by-sa',
                        'cc-by-nd',
                        'arxiv-default','cc-by-nc','cc-by-nc-sa','cc-by-nc-nd','closed','unknown'
                      )),
  tier               TEXT NOT NULL DEFAULT 'A' CHECK (tier IN ('A','B','C')),
  publication_year   INTEGER,                 -- display + BibTeX year; created_at drives recency ranking
  current_version_id INTEGER REFERENCES work_versions(id),
  created_by         INTEGER REFERENCES users(id),   -- NULL for imported works
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (kind != 'concept' OR editing = 'communal')   -- §12.4: concept nodes are always communal in v1
);
CREATE INDEX IF NOT EXISTS idx_works_kind ON works(kind);
CREATE INDEX IF NOT EXISTS idx_works_tier ON works(tier);
CREATE INDEX IF NOT EXISTS idx_works_result_nature ON works(result_nature);
CREATE INDEX IF NOT EXISTS idx_works_created_by ON works(created_by);

-- Immutable, content-addressed versions (§1.3). Rows are never UPDATEd or DELETEd by application code.
CREATE TABLE IF NOT EXISTS work_versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id        INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content_json   TEXT NOT NULL,   -- JSON: { title, abstract, sections: Section[], references: Reference[] }
  content_hash   TEXT NOT NULL,   -- sha256 hex of canonicalJson({title,abstract,sections,references})
  license        TEXT NOT NULL CHECK (license IN (
                    'cc-by','cc-by-sa','cc0','public-domain','platform-cc-by-sa',
                    'cc-by-nd',
                    'arxiv-default','cc-by-nc','cc-by-nc-sa','cc-by-nc-nd','closed','unknown'
                  )),
  change_note    TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (work_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_work_versions_work ON work_versions(work_id);
-- NOT UNIQUE: identical content_json legitimately recurs (a revert reproduces an old hash exactly).
CREATE INDEX IF NOT EXISTS idx_work_versions_hash ON work_versions(content_hash);

-- ============================================================
-- SUBUNITS (§1.2 — Tier C only, enforced in application layer via license.ts, not DDL)
-- ============================================================

CREATE TABLE IF NOT EXISTS subunits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id      INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  version_id   INTEGER NOT NULL REFERENCES work_versions(id),  -- version this subunit was created in
  type         TEXT NOT NULL CHECK (type IN ('hypothesis','method','result','dataset','code','claim','figure')),
  title        TEXT,
  content      TEXT NOT NULL,
  content_hash TEXT NOT NULL,   -- sha256 hex of canonicalJson({type,title,content})
  order_index  INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_subunits_work ON subunits(work_id);

-- ============================================================
-- AUTHORS (external, disambiguated) & AUTHORSHIPS
-- ============================================================

CREATE TABLE IF NOT EXISTS authors (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name          TEXT NOT NULL,
  orcid              TEXT UNIQUE,
  openalex_author_id TEXT UNIQUE,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- position is NOT globally unique per work: equal-contribution co-first-authors may share a position.
CREATE TABLE IF NOT EXISTS authorships (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id      INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  credit_roles TEXT NOT NULL DEFAULT '[]',   -- JSON array of CreditRole slugs (shared/types.ts)
  user_id      INTEGER REFERENCES users(id),
  author_id    INTEGER REFERENCES authors(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (user_id IS NOT NULL OR author_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_authorships_work ON authorships(work_id);
CREATE INDEX IF NOT EXISTS idx_authorships_user ON authorships(user_id);
CREATE INDEX IF NOT EXISTS idx_authorships_author ON authorships(author_id);

-- ============================================================
-- EDGES & VOTES (§2, §4.1–4.2)
-- ============================================================

CREATE TABLE IF NOT EXISTS edges (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source_work_id    INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  target_work_id    INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  source_subunit_id INTEGER REFERENCES subunits(id),
  target_subunit_id INTEGER REFERENCES subunits(id),
  type              TEXT NOT NULL CHECK (type IN (
                       'cites','supports','refutes','replicates','fails_to_replicate',
                       'extends','uses_method_of','provides_data_for','corrects','supersedes',
                       'reviews','comments_on'
                     )),
  origin            TEXT NOT NULL CHECK (origin IN ('human','ai')),
  asserted_by_user  INTEGER REFERENCES users(id),
  model             TEXT,
  model_version     TEXT,
  confidence        REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  basis             TEXT,
  status            TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','confirmed','disputed','rejected')),
  confirmed_by      INTEGER REFERENCES users(id),
  confirmed_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (origin != 'ai' OR (model IS NOT NULL AND confidence IS NOT NULL)),      -- AI edges always carry provenance
  CHECK (origin != 'human' OR asserted_by_user IS NOT NULL),                     -- human edges always attributed
  CHECK (NOT (source_work_id = target_work_id AND source_subunit_id IS target_subunit_id)),  -- no pure self-loops
  UNIQUE (source_work_id, target_work_id, type)   -- deviation from spec §3, documented in §19: prevents duplicate-edge spam; routes return 409/merge on conflict
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_work_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_work_id);
CREATE INDEX IF NOT EXISTS idx_edges_type_status ON edges(type, status);

CREATE TABLE IF NOT EXISTS edge_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  edge_id    INTEGER NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote       INTEGER NOT NULL CHECK (vote IN (1,-1)),
  comment    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (edge_id, user_id)
);

-- ============================================================
-- COMMENTS (§5.4 — granular, sub-unit-anchored, threaded)
-- ============================================================

CREATE TABLE IF NOT EXISTS comments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id        INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  subunit_id     INTEGER REFERENCES subunits(id),
  parent_id      INTEGER REFERENCES comments(id),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  edited_at      TEXT,
  deleted_at     TEXT   -- soft delete: preserves thread structure, body replaced with '[deleted]' by app
);
CREATE INDEX IF NOT EXISTS idx_comments_work ON comments(work_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

-- ============================================================
-- AI OUTPUTS (§4.3–4.6)
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_outputs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id            INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  feature            TEXT NOT NULL CHECK (feature IN ('summary','glossary','explainer')),
  content            TEXT NOT NULL,   -- summary: plain text. glossary: JSON [{term,definition}]. explainer: JSON {question,answer}.
  model              TEXT NOT NULL,
  model_version      TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','flagged','removed')),
  edited_by          INTEGER REFERENCES users(id),
  edited_at          TEXT,
  previous_output_id INTEGER REFERENCES ai_outputs(id),   -- edit chain; NULL for the original AI generation
  is_current         INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_work_feature ON ai_outputs(work_id, feature, is_current);

-- ============================================================
-- FLAGS (§4.5)
-- ============================================================

CREATE TABLE IF NOT EXISTS flags (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type      TEXT NOT NULL CHECK (target_type IN ('ai_output','edge')),
  target_id        INTEGER NOT NULL,
  reporter_user_id INTEGER NOT NULL REFERENCES users(id),
  reason           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','dismissed')),
  resolved_by      INTEGER REFERENCES users(id),
  resolved_at      TEXT,
  resolution_note  TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_flags_target ON flags(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status);

-- ============================================================
-- FULL-TEXT SEARCH (§8)
-- ============================================================

CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5(
  title, abstract, content='works', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS works_fts_insert AFTER INSERT ON works BEGIN
  INSERT INTO works_fts(rowid, title, abstract) VALUES (new.id, new.title, new.abstract);
END;

CREATE TRIGGER IF NOT EXISTS works_fts_delete AFTER DELETE ON works BEGIN
  INSERT INTO works_fts(works_fts, rowid, title, abstract) VALUES ('delete', old.id, old.title, old.abstract);
END;

CREATE TRIGGER IF NOT EXISTS works_fts_update AFTER UPDATE OF title, abstract ON works BEGIN
  INSERT INTO works_fts(works_fts, rowid, title, abstract) VALUES ('delete', old.id, old.title, old.abstract);
  INSERT INTO works_fts(rowid, title, abstract) VALUES (new.id, new.title, new.abstract);
END;
