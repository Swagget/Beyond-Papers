-- Beyond Papers — SQLite schema. Idempotent (IF NOT EXISTS everywhere).
-- Enum values must match shared/types.ts.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_pseudonym INTEGER NOT NULL DEFAULT 0,
  orcid TEXT,
  bio TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('paper','review','replication','concept','dataset','code')),
  result_nature TEXT NOT NULL DEFAULT 'na'
    CHECK (result_nature IN ('positive','negative','null','inconclusive','na')),
  editing TEXT NOT NULL DEFAULT 'authored' CHECK (editing IN ('authored','communal')),
  title TEXT NOT NULL,
  abstract TEXT,
  doi TEXT UNIQUE,
  arxiv_id TEXT UNIQUE,
  openalex_id TEXT UNIQUE,
  source TEXT NOT NULL DEFAULT 'native'
    CHECK (source IN ('native','openalex','crossref','arxiv','pubmed')),
  license TEXT NOT NULL DEFAULT 'unknown'
    CHECK (license IN ('cc-by','cc-by-sa','cc0','public-domain','platform-cc-by-sa',
                       'cc-by-nd','arxiv-default','cc-by-nc','cc-by-nc-sa','cc-by-nc-nd',
                       'closed','unknown')),
  tier TEXT NOT NULL DEFAULT 'A' CHECK (tier IN ('A','B','C')),
  publication_year INTEGER,
  current_version_id INTEGER REFERENCES work_versions(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Immutable, content-addressed versions (§1.3). Rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS work_versions (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  license TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('A','B','C')),
  change_note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (work_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_work_versions_hash ON work_versions(content_hash);

-- Sub-units (§1.2). Tier C works only — enforced in application code.
CREATE TABLE IF NOT EXISTS subunits (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES work_versions(id),
  type TEXT NOT NULL CHECK (type IN ('hypothesis','method','result','dataset','code','claim','figure')),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subunits_work ON subunits(work_id);

CREATE TABLE IF NOT EXISTS authors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  orcid TEXT,
  openalex_author_id TEXT UNIQUE,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_authors_orcid ON authors(orcid);

CREATE TABLE IF NOT EXISTS authorships (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  credit_roles TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (work_id, author_id)
);

-- Typed edges (§2). AI edges always start status='suggested' (§4.2) — enforced in application code.
CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY,
  source_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  target_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  source_subunit_id INTEGER REFERENCES subunits(id),
  target_subunit_id INTEGER REFERENCES subunits(id),
  type TEXT NOT NULL CHECK (type IN ('cites','supports','refutes','replicates','fails_to_replicate',
                                     'extends','uses_method_of','provides_data_for','corrects',
                                     'supersedes','reviews','comments_on')),
  origin TEXT NOT NULL CHECK (origin IN ('human','ai')),
  asserted_by_user INTEGER REFERENCES users(id),
  model TEXT,
  model_version TEXT,
  confidence REAL,
  basis TEXT,
  status TEXT NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested','confirmed','disputed','rejected')),
  confirmed_by INTEGER REFERENCES users(id),
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_work_id, target_work_id, type)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_work_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_work_id);
CREATE INDEX IF NOT EXISTS idx_edges_status ON edges(status);

-- Contested-edge votes (§2.4).
CREATE TABLE IF NOT EXISTS edge_votes (
  edge_id INTEGER NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote INTEGER NOT NULL CHECK (vote IN (1, -1)),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (edge_id, user_id)
);

-- Granular comments (§5.4): whole-work or per-subunit, threaded.
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  subunit_id INTEGER REFERENCES subunits(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_work ON comments(work_id);

-- AI-generated derivative content (§4.3–4.6). Tier C full-text only — enforced in application code.
-- Human edits create a new row pointing at the old one via supersedes_id (§4.4).
CREATE TABLE IF NOT EXISTS ai_outputs (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  feature TEXT NOT NULL CHECK (feature IN ('summary','glossary','explainer')),
  content TEXT NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','flagged','removed')),
  edited_by INTEGER REFERENCES users(id),
  supersedes_id INTEGER REFERENCES ai_outputs(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_work ON ai_outputs(work_id);

-- Hallucination / inaccuracy flags (§4.5).
CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('ai_output','edge')),
  target_id INTEGER NOT NULL,
  reporter_user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','dismissed')),
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  resolution_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_flags_target ON flags(target_type, target_id);

-- Full-text search (§8.1) over title + abstract, external-content FTS5 kept in sync by triggers.
CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5(
  title, abstract, content='works', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS works_ai AFTER INSERT ON works BEGIN
  INSERT INTO works_fts(rowid, title, abstract) VALUES (new.id, new.title, new.abstract);
END;
CREATE TRIGGER IF NOT EXISTS works_ad AFTER DELETE ON works BEGIN
  INSERT INTO works_fts(works_fts, rowid, title, abstract) VALUES ('delete', old.id, old.title, old.abstract);
END;
CREATE TRIGGER IF NOT EXISTS works_au AFTER UPDATE OF title, abstract ON works BEGIN
  INSERT INTO works_fts(works_fts, rowid, title, abstract) VALUES ('delete', old.id, old.title, old.abstract);
  INSERT INTO works_fts(rowid, title, abstract) VALUES (new.id, new.title, new.abstract);
END;
