# Beyond Papers — MVP Architecture Specification

This is the single implementable spec for the "Minimum viable wedge" (Requirements.md) plus governance/about static pages. Implementation agents code from this file alone. Section references (§x.y) are to Requirements.md.

## 0. Scope

In scope (MVP):
- Composite nodes that render/export as papers (§1.1, §1.5), with negative/null/inconclusive results as first-class (§1.4).
- License-driven three-tier ingestion (§3.1–3.4) with importers for DOI/Crossref, arXiv, OpenAlex.
- Typed edges (§2.1–2.4) with AI suggestion + human promotion (§4.1–4.2) and flagging (§4.5).
- Creditable reviews and granular CRediT-style credit (§5.1, §6.2–6.3).
- Low-friction open contribution, authored vs. communal editing (§12.1, §12.3).
- Transparent, non-engagement ranked search (§8).
- Nonprofit/governance and About static pages (§10, §11.2).

Out of scope (deferred, do not build): executable reproducibility sandboxes, sophisticated multi-signal reputation/Sybil resistance (§9), endowment/membership billing, PDF/LaTeX *import* parsing (export only in MVP), full-text search beyond SQLite FTS5, real-time collaboration.

Two non-negotiable boundaries — every route touching them must enforce them, and QA must test them explicitly:
- **Licensing boundary (§3.1–3.2):** license → tier is computed server-side and gates subunit creation, full-content storage, and AI transformation of full text. Never trust a client-supplied tier.
- **AI trust boundary (§4.1–4.2):** AI-inferred edges/outputs are a distinct, provenance-tagged class, always created non-authoritative, never counted until a human confirms them.

## 1. Stack & Runtime

- Node.js >= 20, TypeScript, ESM (`"type": "module"` everywhere; `.js` extensions in relative imports after compilation, use `NodeNext` module resolution).
- Server: Express 4, better-sqlite3 (no ORM, hand-written SQL via prepared statements).
- Client: React 18 + Vite + react-router-dom, hand-written CSS (no CSS framework).
- Single deployable: `npm run build` builds server (tsc) and client (vite build into `client/dist`); in production `server/src/index.ts` serves `client/dist` statically and mounts `/api/*` routes. Dev mode runs Vite dev server proxying `/api` to Express on a different port (configure in `client/vite.config.ts`: `server.proxy['/api'] = 'http://localhost:3000'`).
- Database file: `data/beyond.db` (WAL mode). Directory created on first run if missing.

## 2. Repository Layout

```
package.json            # root: server deps + scripts (dev, build, start, check, seed)
tsconfig.json            # server + shared, NodeNext, strict: true
server/src/index.ts       # express app entry: mounts routes, static serving, error handler
server/src/db.ts          # better-sqlite3 init, runs schema.sql, helper fns
server/src/schema.sql     # full DDL (§3 below)
server/src/lib/
  hash.ts                  # sha256 canonical json, scrypt password hashing
  license.ts                # license -> tier, gate predicates
  auth.ts                   # requireAuth / requireAdmin middleware, cookie+bearer session resolution
  errors.ts                 # AppError class, error codes, central handler
server/src/routes/
  works.ts     edges.ts     reviews.ts    ai.ts        auth.ts
  users.ts     search.ts    import.ts     export.ts    graph.ts     flags.ts
server/src/services/
  aiProvider.ts              # provider interface + factory (env AI_PROVIDER)
  providers/anthropic.ts      providers/heuristic.ts
  ranking.ts                  # search score computation
  dedup.ts                    # external-id + title dedup for importers
  latex.ts                    # content_json -> .tex / .bib / json-metadata
  importers/openalex.ts   importers/crossref.ts   importers/arxiv.ts
shared/types.ts             # all shared TS interfaces + enums (single source of truth)
client/                      # vite app, own package.json
  src/api.ts                  # fetch wrapper (base /api, JSON, credentials: 'include')
  src/pages/                   # route-level components (§12 below)
  src/components/
  src/styles/
scripts/seed.ts              # seeding: demo users, tier A/B/C works, edges, reviews
docs/ARCHITECTURE.md         # this file
```

Server and client are separate npm packages (`client/package.json` for React/Vite deps) but share `shared/types.ts` via a relative import path (client's `tsconfig.json` includes `../shared` in its `include` array; no publishing/build step needed for the shared package since both sides compile it directly).

## 3. Data Model — `server/src/schema.sql`

better-sqlite3 does not persist `PRAGMA foreign_keys` across connections — `db.ts` must call `db.pragma('foreign_keys = ON')` immediately after opening, every process start, before running schema.sql.

All timestamps are ISO-8601 UTC strings produced by SQLite's `strftime('%Y-%m-%dT%H:%M:%fZ','now')` default, or by the application when computed in JS (`new Date().toISOString()`) — both formats are string-sortable and equivalent.

Forward references are legal in SQLite DDL: `works.current_version_id` references `work_versions(id)` even though `work_versions` is declared later in the file, because `work_versions.work_id` references `works(id)`. This circular pair is resolved at INSERT time, not CREATE TABLE time (insert a `works` row with `current_version_id = NULL`, insert the `work_versions` row, then `UPDATE works SET current_version_id = ?`).

All `CREATE TABLE` / `CREATE INDEX` / `CREATE TRIGGER` / `CREATE VIRTUAL TABLE` statements use `IF NOT EXISTS` so `db.ts` can run schema.sql unconditionally on every boot (idempotent migration).

```sql
PRAGMA journal_mode = WAL;

-- ============================================================
-- USERS & AUTH
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
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
  editing            TEXT NOT NULL CHECK (editing IN ('authored','communal')),
  title              TEXT NOT NULL,
  abstract           TEXT,
  doi                TEXT UNIQUE,
  arxiv_id           TEXT UNIQUE,             -- base id, no version suffix, e.g. "2301.12345"
  openalex_id        TEXT UNIQUE,
  source             TEXT NOT NULL CHECK (source IN ('native','openalex','crossref','arxiv','pubmed')),
  license            TEXT NOT NULL CHECK (license IN (
                        'cc-by','cc-by-sa','cc0','public-domain','platform-cc-by-sa',
                        'cc-by-nd',
                        'arxiv-default','cc-by-nc','cc-by-nc-sa','cc-by-nc-nd','closed','unknown'
                      )),
  tier               TEXT NOT NULL CHECK (tier IN ('A','B','C')),
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
-- SUBUNITS (Tier C only — enforced in application layer via license.ts, not DDL)
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
  credit_roles TEXT NOT NULL DEFAULT '[]',   -- JSON array of CreditRole slugs, see §4 CreditRole enum
  user_id      INTEGER REFERENCES users(id),
  author_id    INTEGER REFERENCES authors(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (user_id IS NOT NULL OR author_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_authorships_work ON authorships(work_id);
CREATE INDEX IF NOT EXISTS idx_authorships_user ON authorships(user_id);
CREATE INDEX IF NOT EXISTS idx_authorships_author ON authorships(author_id);

-- ============================================================
-- EDGES & VOTES
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
  CHECK (NOT (source_work_id = target_work_id AND source_subunit_id IS target_subunit_id AND target_subunit_id IS source_subunit_id))
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

CREATE TRIGGER IF NOT EXISTS works_ai AFTER INSERT ON works BEGIN
  INSERT INTO works_fts(rowid, title, abstract) VALUES (new.id, new.title, new.abstract);
END;

CREATE TRIGGER IF NOT EXISTS works_ad AFTER DELETE ON works BEGIN
  INSERT INTO works_fts(works_fts, rowid, title, abstract) VALUES ('delete', old.id, old.title, old.abstract);
END;

CREATE TRIGGER IF NOT EXISTS works_au AFTER UPDATE ON works BEGIN
  INSERT INTO works_fts(works_fts, rowid, title, abstract) VALUES ('delete', old.id, old.title, old.abstract);
  INSERT INTO works_fts(rowid, title, abstract) VALUES (new.id, new.title, new.abstract);
END;
```

### Chats — uploaded AI conversations (`chats`, `chat_links`)

Two later-added tables (idempotent, in `schema.sql`) implement uploaded AI conversations attached to works under the §4.1–4.2 trust pattern:

- `chats(id, url, platform ∈ claude|chatgpt|gemini|other, title, transcript, content_hash, uploaded_by → users, status ∈ pending|verified, verified_at, created_at)` — a pasted AI-chat transcript with optional share-link provenance. `status='pending'` chats are visible **only** to their uploader (and admins); routes return 404 to everyone else.
- `chat_links(id, chat_id → chats CASCADE, work_id → works CASCADE, origin ∈ human|ai, model, model_version, confidence, basis, status ∈ suggested|confirmed|rejected, confirmed_by, confirmed_at, created_at, UNIQUE(chat_id, work_id), CHECK ai ⇒ model+confidence)` — a chat→work attachment. AI-proposed links land as `suggested` with full provenance; only the uploader promotes them to `confirmed` (or `rejected`). Manual uploader attachments are `origin='human'`, instantly `confirmed`.

Matching (`services/chatMatcher.ts`) runs at upload in two lanes: (1) DOIs / arXiv ids literally present in the transcript resolve directly against `works` (model `identifier-extractor`, confidence 0.97); (2) FTS-selected candidates (top transcript terms, OR-query, bm25) go to the configured `AiProvider.matchChat(excerpt, candidates)` (heuristic TF-IDF cosine or Anthropic strict-JSON). The transcript excerpt sent to the provider is capped at 20 000 chars. A chat can only be `verified` once every `suggested` link is resolved; work pages surface only `confirmed` links of `verified` chats.

`db.ts` responsibilities: open `data/beyond.db` (create parent dir if missing), `pragma('foreign_keys = ON')`, `pragma('journal_mode = WAL')`, execute `schema.sql` via `db.exec(readFileSync(...))`, export the `Database` instance plus small helpers: `nowIso()`, `runInTransaction(fn)`, `setCurrentVersion(workId, versionId)` (updates `works.current_version_id` and `works.updated_at`).

## 4. `shared/types.ts` — Single Source of Truth

```ts
// ---------- Enums ----------

export type WorkKind = 'paper' | 'review' | 'replication' | 'concept' | 'dataset' | 'code';
export type ResultNature = 'positive' | 'negative' | 'null' | 'inconclusive' | 'na';
export type EditingMode = 'authored' | 'communal';
export type WorkSource = 'native' | 'openalex' | 'crossref' | 'arxiv' | 'pubmed';

export type LicenseId =
  | 'cc-by' | 'cc-by-sa' | 'cc0' | 'public-domain' | 'platform-cc-by-sa'   // Tier C
  | 'cc-by-nd'                                                              // Tier B
  | 'arxiv-default' | 'cc-by-nc' | 'cc-by-nc-sa' | 'cc-by-nc-nd' | 'closed' | 'unknown'; // Tier A

export type Tier = 'A' | 'B' | 'C';

export type SubunitType = 'hypothesis' | 'method' | 'result' | 'dataset' | 'code' | 'claim' | 'figure';

// Standard CRediT taxonomy (https://credit.niso.org/) — exact 14 slugs, no others accepted.
export type CreditRole =
  | 'conceptualization' | 'data_curation' | 'formal_analysis' | 'funding_acquisition'
  | 'investigation' | 'methodology' | 'project_administration' | 'resources'
  | 'software' | 'supervision' | 'validation' | 'visualization'
  | 'writing_original_draft' | 'writing_review_editing';

export type EdgeType =
  | 'cites' | 'supports' | 'refutes' | 'replicates' | 'fails_to_replicate'
  | 'extends' | 'uses_method_of' | 'provides_data_for' | 'corrects' | 'supersedes'
  | 'reviews' | 'comments_on';

export type EdgeOrigin = 'human' | 'ai';
export type EdgeStatus = 'suggested' | 'confirmed' | 'disputed' | 'rejected';

export type AiFeature = 'summary' | 'glossary' | 'explainer';
export type AiOutputStatus = 'active' | 'flagged' | 'removed';

export type FlagTargetType = 'ai_output' | 'edge';
export type FlagStatus = 'open' | 'upheld' | 'dismissed';

export type GraphDirection = 'ancestors' | 'descendants' | 'both';

export type AiProviderName = 'anthropic' | 'heuristic';

// ---------- Content ----------

export interface Section {
  heading: string;
  body: string;
  order: number;
}

export interface Reference {
  label: string;        // e.g. "[1]" or a citation key
  raw: string;           // formatted citation text as authored
  work_id?: number;       // resolved internal link, if any
  doi?: string;
  url?: string;
}

export interface WorkContent {
  title: string;
  abstract: string;
  sections: Section[];    // must be [] when tier === 'A'
  references: Reference[];
}

// ---------- Core entities ----------

export interface User {
  id: number;
  username: string;
  display_name: string;
  is_pseudonym: boolean;
  orcid: string | null;
  bio: string | null;
  is_admin: boolean;
  created_at: string;
}
export type PublicUser = Omit<User, never>; // password_hash is never selected into a User object at all

export interface Work {
  id: number;
  kind: WorkKind;
  result_nature: ResultNature;
  editing: EditingMode;
  title: string;
  abstract: string | null;
  doi: string | null;
  arxiv_id: string | null;
  openalex_id: string | null;
  source: WorkSource;
  license: LicenseId;
  tier: Tier;
  current_version_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface WorkVersion {
  id: number;
  work_id: number;
  version_number: number;
  content: WorkContent;   // parsed from content_json
  content_hash: string;
  license: LicenseId;
  change_note: string | null;
  created_by: number | null;
  created_at: string;
}

export interface AuthorPreview {
  position: number;
  name: string;
  user_id: number | null;
  author_id: number | null;
  orcid: string | null;
  credit_roles: CreditRole[];
}

export interface WorkSummary extends Work {
  authors: AuthorPreview[];
}

export interface Subunit {
  id: number;
  work_id: number;
  version_id: number;
  type: SubunitType;
  title: string | null;
  content: string;
  content_hash: string;
  order_index: number;
  created_by: number | null;
  created_at: string;
}

export interface WorkDetail extends WorkSummary {
  current_version: WorkVersion;
  subunits: Subunit[];   // [] unless tier === 'C'
}

export interface Author {
  id: number;
  full_name: string;
  orcid: string | null;
  openalex_author_id: string | null;
}

export interface Authorship {
  id: number;
  work_id: number;
  position: number;
  credit_roles: CreditRole[];
  user_id: number | null;
  author_id: number | null;
}

export interface Edge {
  id: number;
  source_work_id: number;
  target_work_id: number;
  source_subunit_id: number | null;
  target_subunit_id: number | null;
  type: EdgeType;
  origin: EdgeOrigin;
  asserted_by_user: number | null;
  model: string | null;
  model_version: string | null;
  confidence: number | null;
  basis: string | null;
  status: EdgeStatus;
  confirmed_by: number | null;
  confirmed_at: string | null;
  created_at: string;
}

export interface EdgeDetail extends Edge {
  votes: { up: number; down: number; my_vote: -1 | 0 | 1 };
}

export interface EdgeVote {
  id: number;
  edge_id: number;
  user_id: number;
  vote: 1 | -1;
  comment: string | null;
  created_at: string;
}

export interface Comment {
  id: number;
  work_id: number;
  subunit_id: number | null;
  parent_id: number | null;
  author_user_id: number;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface AiOutput {
  id: number;
  work_id: number;
  feature: AiFeature;
  content: string;    // summary/explainer: text or {question,answer} JSON string. glossary: JSON array string.
  model: string;
  model_version: string;
  status: AiOutputStatus;
  edited_by: number | null;
  edited_at: string | null;
  previous_output_id: number | null;
  is_current: boolean;
  created_at: string;
}

export interface GlossaryEntry { term: string; definition: string; }
export interface ExplainerContent { question: string; answer: string; }

export interface Flag {
  id: number;
  target_type: FlagTargetType;
  target_id: number;
  reporter_user_id: number;
  reason: string;
  status: FlagStatus;
  resolved_by: number | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

export interface AccuracyTrackRecord {
  feature: AiFeature;
  open: number;
  upheld: number;
  dismissed: number;
}

// ---------- Search & Graph ----------

export interface ScoreComponents {
  relevance: number;      // 0..1, from FTS5 bm25
  rigor: number;           // 0..1, normalized confirmed supports+replications-fails_to_replicate
  review_count: number;     // 0..1, normalized confirmed 'reviews' edge count
  recency: number;          // 0..1, exponential decay
}

export interface SearchResultItem {
  work: WorkSummary;
  score: number;              // weighted total, 0..1
  score_components: ScoreComponents;
}

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  limit: number;
  offset: number;
  weights: ScoreComponents;    // the weight constants used, for transparency (§8.3)
}

export interface GraphNode {
  id: number;
  kind: WorkKind;
  title: string;
  result_nature: ResultNature;
  tier: Tier;
}

export interface GraphEdge {
  id: number;
  source_work_id: number;
  target_work_id: number;
  type: EdgeType;
  origin: EdgeOrigin;
  status: EdgeStatus;
  confidence: number | null;
}

export interface GraphResponse {
  root_id: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

// ---------- Misc ----------

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ImportResult {
  work: WorkDetail;
  created: boolean;   // false when deduped onto an existing work
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
```

## 5. Licensing Boundary — `server/src/lib/license.ts`

Exact mapping (do not add or remove license ids without a spec change):

| Tier | Licenses |
|---|---|
| C — full rich node, transformable | `cc-by`, `cc-by-sa`, `cc0`, `public-domain`, `platform-cc-by-sa` |
| B — host whole, unchanged | `cc-by-nd` |
| A — metadata + link only | `arxiv-default`, `cc-by-nc`, `cc-by-nc-sa`, `cc-by-nc-nd`, `closed`, `unknown` |

`platform-cc-by-sa` is the license applied to natively-authored/contributed works per §3.7 (the platform's own CC-BY-SA 4.0 outbound license) — it is Tier C by definition (author-contributed).

```ts
export function licenseToTier(license: LicenseId): Tier {
  switch (license) {
    case 'cc-by': case 'cc-by-sa': case 'cc0': case 'public-domain': case 'platform-cc-by-sa':
      return 'C';
    case 'cc-by-nd':
      return 'B';
    default: // arxiv-default, cc-by-nc, cc-by-nc-sa, cc-by-nc-nd, closed, unknown
      return 'A';
  }
}

// Three independent gate predicates — see reconciliation note below.
export function canStoreFullContent(tier: Tier): boolean { return tier === 'B' || tier === 'C'; }
export function canCreateSubunits(tier: Tier): boolean { return tier === 'C'; }
export function canAiTransformFullText(tier: Tier): boolean { return tier === 'C'; }

export function isNc(license: LicenseId): boolean {
  return license === 'cc-by-nc' || license === 'cc-by-nc-sa' || license === 'cc-by-nc-nd';
}
```

**Gate reconciliation.** Three server-side gates exist: (1) subunit creation, (2) full-content storage beyond title/abstract, (3) AI transformation of full text. Gates (1) and (3) require Tier C only. Gate (2) requires Tier B **or** C — Tier B hosts the whole work unmodified (§3.1: "host whole, unchanged") but may never be decomposed or AI-transformed. Every route that writes `work_versions.content_json.sections` or reads full section content for an AI prompt must call the matching predicate; never infer permission from the client-supplied tier — always recompute `licenseToTier(license)` server-side from the version's own `license` column.

**Enforcement points (exhaustive list):**
- `POST /api/works` and `PATCH /api/works/:id`: if `licenseToTier(license) === 'A'`, `sections` must be `[]` (422 `LICENSE_GATE` otherwise). If tier is `B` or `C`, sections are stored as given.
- `POST /api/works/:id/subunits`: 403 `LICENSE_GATE` unless `canCreateSubunits(work.tier)`.
- `PATCH /api/works/:id` license downgrade: if the new license resolves to a tier below `C` and the work has existing subunits, reject with 409 `CONFLICT` ("cannot downgrade below tier C while subunits exist").
- `POST /api/works/:id/ai/summarize` and `/glossary`: always permitted at any tier, but the **content passed to the provider** is `{title, abstract}` only unless `canAiTransformFullText(work.tier)`, in which case full `sections` are included too. This is a scope restriction, not a hard block (§4.3: "for Tier A/B, AI operates on metadata and abstracts only").
- `POST /api/works/:id/ai/suggest-edges`: always uses `{title, abstract}` only, regardless of tier (this data is already public at every tier) — no gate needed.
- Importers: Tier A/B/C is computed from the mapped source license; NC-licensed works are always created as Tier A metadata-only per §3.2, even if the source marks them "open access."

## 6. Auth Model — `server/src/lib/auth.ts`, `hash.ts`

**Password hashing** (`hash.ts`): Node's built-in `crypto.scrypt`, params `N=16384, r=8, p=1, keylen=64`, random 16-byte salt. Stored as a single string: `scrypt:16384:8:1:<saltHex>:<hashHex>`.

```ts
export function hashPassword(password: string): string;
export function verifyPassword(password: string, stored: string): boolean;   // constant-time compare via crypto.timingSafeEqual
export function canonicalJson(value: unknown): string;   // recursively sort object keys; array order preserved as-is
export function sha256Hex(input: string): string;         // crypto.createHash('sha256').update(input,'utf8').digest('hex')
```

`content_hash` on `work_versions` = `sha256Hex(canonicalJson({ title, abstract, sections, references }))` — exactly these four fields, nothing else (not `license`, not `change_note`, not timestamps). `content_hash` on `subunits` = `sha256Hex(canonicalJson({ type, title, content }))`.

**Sessions.** Registration and login are open, no gatekeeper (§12.1). `POST /api/auth/register` and `/login` issue an opaque token (`crypto.randomBytes(32).toString('hex')`) stored in `sessions`, `expires_at = now + SESSION_TTL_DAYS` (env, default 30 days). The token is returned in the JSON body **and** set as `Set-Cookie: session_token=<token>; HttpOnly; SameSite=Lax; Path=/` (secure flag added when `NODE_ENV=production`).

```ts
export function requireAuth(req, res, next): void;   // resolves session from cookie 'session_token' or 'Authorization: Bearer <token>' header (cookie checked first); 401 UNAUTHORIZED if missing/expired; attaches req.user: User
export function requireAdmin(req, res, next): void;   // chain after requireAuth; 403 FORBIDDEN if !req.user.is_admin
```

`ORCID` format validation (both `users.orcid` and importer-populated `authors.orcid`): `/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/` — checksum digit is not verified in MVP (documented simplification, see §15).

**Read/write split.** Every `GET` route in this spec is public, no auth required (research is never paywalled). Every `POST`/`PATCH`/`DELETE` route requires `requireAuth` unless the route table below marks it `admin` (`requireAuth` + `requireAdmin`) or `open` (pre-auth, i.e. register/login themselves).

**Edit permission (§12.3).** `authored` works: only a user linked via `authorships.user_id` on that work, or `works.created_by`, may `PATCH`/create subunits/revert. `communal` works (concept nodes always; any other work an author explicitly marks communal): any authenticated user may `PATCH`. Both paths always go through the same "create new `work_versions` row" flow — no in-place mutation, ever (§1.3, §12.5).

## 7. AI Trust Boundary — `server/src/services/aiProvider.ts`

```ts
export interface AiProvider {
  suggestEdges(work: WorkDetail, candidates: WorkSummary[]): Promise<SuggestedEdge[]>;
  summarize(work: WorkDetail, scope: 'abstract' | 'full'): Promise<string>;
  glossary(work: WorkDetail, scope: 'abstract' | 'full'): Promise<GlossaryEntry[]>;
}

export interface SuggestedEdge {
  target_work_id: number;
  type: EdgeType;
  confidence: number;   // 0..1
  basis: string;
}

export function getAiProvider(): AiProvider;   // factory, reads env AI_PROVIDER ('anthropic'|'heuristic'), default 'heuristic'
```

**Provider selection.** `AI_PROVIDER=anthropic` requires `ANTHROPIC_API_KEY`; if unset at boot with `AI_PROVIDER=anthropic`, fail fast (throw on startup, not on first request) so misconfiguration is caught immediately. `AI_PROVIDER=heuristic` (default) needs no external calls — the app must be fully demoable with zero API keys and zero cost.

### 7.1 `providers/heuristic.ts` (deterministic, no network)

- **`suggestEdges`**: TF-IDF vectors over `title + ' ' + abstract` (lowercased, tokenized on `\W+`, stopword-filtered with a small built-in list) for the analyzed work and every candidate; cosine similarity between the work's vector and each candidate's vector. Keep candidates with similarity `>= MIN_CONFIDENCE (0.15)`, sorted descending, capped at `MAX_SUGGESTIONS (5)`. `type` is always `'cites'` (the heuristic cannot infer semantic edge types), `confidence = similarity`, `basis = "TF-IDF cosine similarity: 0.NN"`.
- **`summarize`**: extractive — split into sentences, score each by sum of TF-IDF weights of its terms, return the top 3 sentences (or top 5 if `scope==='full'`) in original order, joined into a paragraph.
- **`glossary`**: extract candidate terms via regex over the input text — capitalized multi-word phrases (`([A-Z][a-z]+ ){1,3}[A-Z][a-z]+`) and single tokens containing digits or ALL-CAPS acronyms (`\b[A-Z]{2,}\b`) — dedupe, drop common words (title-case sentence starts), cap at 12 terms; `definition` is a fixed placeholder string `"Technical term found in this work — no definition available from the heuristic provider."` (the heuristic cannot generate real definitions; this is honest about its limitation rather than fabricating one).

### 7.2 `providers/anthropic.ts`

Calls `POST https://api.anthropic.com/v1/messages` with headers `x-api-key: <ANTHROPIC_API_KEY>`, `anthropic-version: 2023-06-01`, `content-type: application/json`, body `{ model: "claude-sonnet-5", max_tokens: <1024|2048>, system: "<task-specific instruction forcing strict JSON output>", messages: [{ role: "user", content: "<prompt>" }] }`.

- **`suggestEdges`**: prompt includes the analyzed work's title/abstract and a numbered candidate list (id, title, abstract) drawn from the top 20 FTS5 `bm25`-ranked works (pre-filter to keep the prompt small); system prompt demands a JSON array `[{candidate_index, type, confidence, basis}]` restricted to the given `EdgeType` enum. Response is parsed with `JSON.parse` inside a `try/catch`; entries referencing an out-of-range `candidate_index`, an invalid `type`, or a non-numeric `confidence` are silently dropped; `confidence` is clamped to `[0,1]`. If parsing fails entirely, return `[]` (never throw — a bad AI response degrades to "no suggestions," not a 500).
- **`summarize`** / **`glossary`**: same JSON-strict-output pattern; input content is `{title, abstract}` when `scope==='abstract'`, `{title, abstract, sections}` when `scope==='full'` — the route layer decides `scope` via `canAiTransformFullText`, the provider never makes tier decisions itself.

### 7.3 Boundary rules (enforced in `routes/ai.ts` and `routes/edges.ts`, not the provider)

- AI-created edges: `origin='ai'`, `status` **always** starts `'suggested'`, `model`/`model_version`/`confidence`/`basis` always populated — the DB `CHECK` constraint (`origin != 'ai' OR (model IS NOT NULL AND confidence IS NOT NULL)`) makes this unbypassable at the schema level.
- Human-asserted edges (`POST /api/edges`): `origin='human'`, `status` is set directly to `'confirmed'` at creation (`asserted_by_user = confirmed_by = req.user.id`, `confirmed_at = now`) — §4.2's promotion requirement is explicitly scoped to AI-inferred edges ("Every *AI-inferred* edge..."); a human asserting an edge directly is not a "suggestion" needing a second human's promotion, consistent with the low-friction contribution model (§12.1–12.2). Community disputing/voting (edge_votes, `dispute` action) is the after-the-fact quality control.
- Edge status transitions (state machine, enforced in `routes/edges.ts`):
  - `suggested → confirmed` via `POST /api/edges/:id/confirm` (any authenticated user — see §15 simplification).
  - `suggested → rejected` via `POST /api/edges/:id/reject`.
  - `confirmed → disputed` via `POST /api/edges/:id/dispute`.
  - `disputed → confirmed` via `confirm` (re-affirm), `disputed → rejected` via `reject`.
  - `rejected` is terminal in v1 (no route transitions out of it; to reverse, assert a new edge).
  - Any other transition attempt returns 422 `INVALID_TRANSITION`.
- Ranking, rigor counts, review counts, and graph "authoritative traversal" (default, `include_ai=false`) all query `WHERE status = 'confirmed'` (or explicitly include `'disputed'` where noted) and **never** `'suggested'` — see §8 and §11.
- `ai_outputs` rows are never inserted into `edges`, never counted in rigor/review/ranking, and are excluded from citation unless the citing work explicitly references them with `model`/`model_version` provenance in a `Reference` (§4.6) — the app does not auto-populate `Reference.work_id` for `ai_outputs` since `ai_outputs` are not `works` rows at all (by design: AI output is never a citable node itself, only human-authored works/reviews are).
- `explainer` outputs are stored (per the `ai_outputs.feature` enum) exactly like `summary`/`glossary` — same table, same edit-chain, same flaggability — but are UI-labeled as low-stakes/reader-aid (§4.7) rather than an authored artifact; there is no separate storage-privacy mechanism in v1 (no per-viewer scoping column exists), so explainer answers are visible to anyone viewing the work, which doubles as a lightweight FAQ. This is a deliberate simplification — see §15.
- `GET /api/graph/:workId` default (`include_ai=false`) excludes edges where `origin='ai' AND status='suggested'`; always excludes `status='rejected'`; `include_ai=true` includes AI-origin `suggested` edges too (still visually/semantically tagged via `origin`/`confidence` fields in the response — the client is responsible for rendering AI-suggested edges as visually distinct, e.g. dashed lines).

## 8. Search & Ranking — `server/src/services/ranking.ts`

FTS5 query (`routes/search.ts`): `SELECT works.*, bm25(works_fts) AS bm25_raw FROM works_fts JOIN works ON works.id = works_fts.rowid WHERE works_fts MATCH ? ...` (SQLite FTS5's `bm25()` returns lower-is-better, typically negative). Score is a transparent weighted sum, returned **with its component breakdown** in every result (§8.3):

```ts
export const WEIGHTS = { relevance: 0.45, rigor: 0.25, review_count: 0.15, recency: 0.15 } as const;
export const RIGOR_CAP = 20;          // log1p normalization cap for rigor
export const REVIEW_CAP = 10;         // log1p normalization cap for review_count
export const RECENCY_HALF_LIFE_DAYS = 730;  // 2 years
```

Component formulas (all normalized to `0..1`):
- `relevance`: min-max normalize `-bm25_raw` across the current result page (`(x - min) / (max - min)`, or `1` if all results tie).
- `rigor_raw = confirmed('replicates' → work) + confirmed('supports' → work) - confirmed('fails_to_replicate' → work)` counting edges where `target_work_id = work.id AND status = 'confirmed'` for each named type; clipped at 0 minimum. `rigor = min(1, log1p(max(0, rigor_raw)) / log1p(RIGOR_CAP))`.
- `review_count_raw = count of confirmed 'reviews' edges where target_work_id = work.id` (the review is the source, the reviewed work is the target). `review_count = min(1, log1p(review_count_raw) / log1p(REVIEW_CAP))`.
- `recency = exp(-ln(2) * age_days / RECENCY_HALF_LIFE_DAYS)`, `age_days = (now - work.created_at) / 86400000`.
- `score = WEIGHTS.relevance*relevance + WEIGHTS.rigor*rigor + WEIGHTS.review_count*review_count + WEIGHTS.recency*recency`.

Results are sorted by `score` descending. No engagement metric (views, likes, follower count) appears anywhere in this formula or schema — by construction, not by omission.

## 9. Export — `server/src/services/latex.ts`

- `GET /api/works/:id/export/latex` → `Content-Type: application/x-latex`, `Content-Disposition: attachment; filename="work-<id>-v<version_number>.tex"`. Renders `\documentclass{article}`, `\title{}`/`\author{}` from ordered `authorships` (falls back to `Anonymous` if no authors), `\begin{abstract}...\end{abstract}`, one `\section{heading}` per `Section` in `sections` (in `order`), and a `thebibliography` environment built from `references` (`\bibitem{label} raw`). Works with empty `sections` (Tier A) still render a valid stub article (title/authors/abstract/bibliography only) — no additional gating needed at export time since tier-appropriate content is enforced at write time.
- `GET /api/works/:id/export/bibtex` → `Content-Type: application/x-bibtex`. `@article{work<id>, title={...}, author={Last, First and Last2, First2}, year={<from created_at>}, doi={...}, note={Beyond Papers node #<id>, tier <tier>, license <license>}}`.
- `GET /api/works/:id/export/json` → Crossref-like envelope: `{ DOI, title, abstract, author: [{given,family,ORCID}], type: <kind-mapped>, published: {"date-parts": [[Y,M,D]]}, license: [{URL, "content-version": "vor", "delay-in-days": 0}], reference: [...], "beyond-papers": { id, tier, kind, result_nature, current_version_hash } }`. The `beyond-papers` key is a namespaced extension carrying platform-specific fields Crossref itself has no slot for.
- `GET /api/versions/:hash` → resolves a frozen, content-addressed version (§1.3). Because `content_hash` is intentionally **not** globally unique (a `revert` legitimately reproduces an old hash byte-for-byte), the response is a list: `{ matches: [{ version: WorkVersion, work: { id, title, tier, license } }] }`, most recent `created_at` first. 404 if no `work_versions.content_hash` matches.

## 10. Importers — `server/src/services/importers/*`, `dedup.ts`

**Dedup (`dedup.ts`).** Given `{doi?, arxiv_id?, openalex_id?, title}`, look up `works` by any non-null external id first (exact match only). If found, backfill any external id columns the existing row is missing (e.g. an OpenAlex import brings a DOI onto a row that only had `arxiv_id`) and return `{work, created:false}`. If no external-id match, fall back to an **exact**, normalized (`lowercase`, strip punctuation/whitespace-collapse) title match against existing `native`-sourced and same-source works only; on a title collision, still create a new row (do not auto-merge on title alone) but the importer response sets a `possible_duplicate_of` hint in server logs — auto-merging on fuzzy title match is out of scope for v1 (documented limitation, §15).

**License URL → `LicenseId` mapping** (used by all three importers), matched by path prefix, version-agnostic:

| URL contains | LicenseId |
|---|---|
| `/licenses/by/` | `cc-by` |
| `/licenses/by-sa/` | `cc-by-sa` |
| `/licenses/by-nd/` | `cc-by-nd` |
| `/licenses/by-nc/` | `cc-by-nc` |
| `/licenses/by-nc-sa/` | `cc-by-nc-sa` |
| `/licenses/by-nc-nd/` | `cc-by-nc-nd` |
| `/publicdomain/zero/` | `cc0` |
| `/publicdomain/mark/` | `public-domain` |
| (arXiv, no explicit CC license found) | `arxiv-default` |
| absent / unrecognized | `unknown` |
| Crossref explicit TDM-restricted, no license array | `closed` |

- **`importers/crossref.ts`** — `GET https://api.crossref.org/works/{doi}`. Maps `message.title[0]`, `message.author[]` (`given`+`family`, `ORCID` if present → `authors` row keyed by `orcid`), `message.license[]` URL via the table above, `message.published.date-parts`. Crossref rarely provides an abstract; `abstract: null` is valid. Creates `works.source='crossref'`, `kind='paper'`, `editing='authored'`... concept CHECK doesn't apply. `created_by = NULL` (imported, no local creator). One `work_versions` row, `version_number=1`, `sections=[]` unless tier allows more (Crossref never supplies full text, so `sections` is always `[]` regardless of tier from this importer).
- **`importers/arxiv.ts`** — `GET http://export.arxiv.org/api/query?id_list={arxiv_id}` (Atom XML). **Versioning maps directly onto `work_versions`**: `works.arxiv_id` stores the base id without version suffix (e.g. `2301.12345`); each fetched arXiv version (`v1`, `v2`, ...) becomes its own `work_versions` row with `version_number` = the arXiv version integer and **its own `license`** read from the `<arxiv:license>` Atom extension (mapped via the table above; absent → `arxiv-default`) — this is the concrete realization of §3.6 "arXiv versions can carry different licenses." Re-importing the same `arxiv_id` fetches the current Atom entry; if its version number is newer than the work's latest stored `work_versions.version_number`, append a new version row (never overwrite). `title`/`summary` map to `title`/`abstract`; `sections=[]` (arXiv Atom API exposes metadata only, not full text) regardless of tier.
- **`importers/openalex.ts`** — single: `GET https://api.openalex.org/works/{openalex_id}`; batch: `GET https://api.openalex.org/works?search={query}&per-page={limit<=50}`. Maps `display_name`→`title`, reconstructs `abstract` from `abstract_inverted_index` (invert the `{word: [positions]}` map back into plain text by position), `authorships[].author.display_name`/`orcid`, `doi`, `id`→`openalex_id`, `primary_location.license` (OpenAlex already uses short codes like `cc-by`, `cc-by-nc`, `cc0` — map 1:1 where the code matches a `LicenseId`, else `unknown`), `publication_date`.

All three importers: dedup by external id before insert (never create a duplicate `works` row for the same `doi`/`arxiv_id`/`openalex_id`), map authors through `authors`/`authorships` with `orcid` linkage when present, and always compute `tier = licenseToTier(mapped_license)` server-side — an importer never trusts a source's self-reported "open access" flag as a license (§3.1: "'Open access'... does not by itself grant reuse rights").

## 11. Graph API — `routes/graph.ts`

`GET /api/graph/:workId?depth=1..3&types=csv&direction=ancestors|descendants|both&include_ai=bool`

BFS from `workId` up to `depth` (default `1`, values outside `1..3` → 400 `VALIDATION_ERROR`). `direction=ancestors` walks incoming edges (`target_work_id = current`, moving to `source_work_id`); `descendants` walks outgoing edges (`source_work_id = current`, moving to `target_work_id`); `both` walks both per hop. `types` (optional, CSV of `EdgeType`) restricts which edge types are traversed/returned; omitted = all types. Filtering rule (always applied, both directions): exclude `status='rejected'` always; exclude `origin='ai' AND status='suggested'` unless `include_ai=true`. Hard cap `500` nodes / `2000` edges per call — if the cap is hit mid-traversal, stop expanding and set `truncated: true`. Response shape is `GraphResponse` (§4 types). This endpoint is the sole data source for the client's graph visualization page.

`GET /api/graph?types=csv&include_ai=bool` (no root) — field-wide overview: the up-to-500 most-connected works (degree over non-rejected edges, ties by recency) plus every qualifying edge among them (same AI/type filtering, capped at 2000, `truncated` set when either cap is hit). `root_id` is `null` in the response; `GraphResponse.root_id` is `number | null` for this reason. Backs the client's `/graph` route.

## 12. Client Application — page inventory

Visual design ownership sits outside this document (hand-written CSS in `client/src/styles/`); this is the route/data map only.

| Route | Page component | Primary API calls |
|---|---|---|
| `/` | Home / discovery feed | `GET /api/search` (empty query = recent/top by score) |
| `/search?q=` | Search results | `GET /api/search` |
| `/works/:id` | Work detail (renders as a paper: abstract, sections, subunits, authors, edges, reviews, comments) | `GET /api/works/:id`, `GET /api/works/:id/edges`, `GET /api/works/:id/comments`, `GET /api/works/:id/reviews`, `GET /api/works/:id/ai`, `GET /api/works/:id/chats` |
| `/works/:id/edit` | New-version editor (auth-gated by edit permission) | `PATCH /api/works/:id` |
| `/works/:id/versions` | Version history + revert | `GET /api/works/:id/versions`, `POST /api/works/:id/revert` |
| `/works/:id/graph` | Graph visualization centered on this work | `GET /api/graph/:id` |
| `/graph` | Field-wide graph explorer (whole corpus, no root) | `GET /api/graph` |
| `/chats` | Conversation list (verified public + own uploads) | `GET /api/chats`, `GET /api/chats?mine=true` |
| `/chats/new` | Upload an AI conversation (auth) | `POST /api/chats` |
| `/chats/:id` | Chat review workbench: confirm/reject suggestions, manual attach, verify, transcript | `GET /api/chats/:id`, `POST /api/chats/:id/links[...]`, `POST /api/chats/:id/verify` |
| `/works/new` | New work / new review composer | `POST /api/works`, `POST /api/works/:id/reviews` |
| `/import` | Import-by-DOI/arXiv/OpenAlex form | `POST /api/import/doi`, `/arxiv`, `/openalex` |
| `/users/:id` | Public profile (§6.1: authored nodes, subunits, reviews, data, code) | `GET /api/users/:id`, `GET /api/users/:id/works`, `GET /api/users/:id/reviews` |
| `/login`, `/register` | Auth forms | `POST /api/auth/login`, `/register` |
| `/settings` | Own profile edit | `GET /api/auth/me`, `PATCH /api/users/:id` |
| `/flags` | Moderation queue (admin only) | `GET /api/flags`, `POST /api/flags/:id/resolve` |
| `/ai/track-record` | Public AI accuracy dashboard | `GET /api/ai/track-record` |
| `/about` | Static: what Beyond Papers is, the beachhead subfield (§11.2), no-career-penalty pitch (§11.1) | none |
| `/governance` | Static: nonprofit/POSI structure (§10.1), funding layers (§10.2), data portability (§10.3) | none |

`client/src/api.ts` is a thin `fetch` wrapper: `apiGet(path)`, `apiPost(path, body)`, `apiPatch(path, body)`, always `credentials: 'include'` (session cookie), always `Content-Type: application/json` on write bodies, throws a typed error carrying `{code, message}` parsed from `ApiError` responses.

## 13. REST Route Table

Blanket rule: all `GET` routes are public (no auth). All `POST`/`PATCH`/`DELETE` routes require `requireAuth` unless marked `open` (pre-auth) or `admin` (`requireAuth`+`requireAdmin`). Every route returns `ApiError` `{error:{code,message}}` on failure; common codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `LICENSE_GATE` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INVALID_TRANSITION` (422), `INTERNAL` (500). Per-route error columns below list the non-generic ones worth calling out.

### 13.1 `routes/auth.ts`

| Method | Path | Auth | Request body | Response | Notable errors |
|---|---|---|---|---|---|
| POST | `/api/auth/register` | open | `{username, password, display_name, is_pseudonym?, orcid?, bio?}` | `201 {user: User, session_token}` (+ Set-Cookie) | 409 `CONFLICT` username taken |
| POST | `/api/auth/login` | open | `{username, password}` | `200 {user: User, session_token}` (+ Set-Cookie) | 401 `UNAUTHORIZED` bad credentials |
| POST | `/api/auth/logout` | auth | — | `204` | — |
| GET | `/api/auth/me` | auth | — | `200 {user: User}` | 401 |

### 13.2 `routes/users.ts`

| Method | Path | Auth | Request body | Response |
|---|---|---|---|---|
| GET | `/api/users/:id` | public | — | `200 {user: PublicUser}` |
| PATCH | `/api/users/:id` | auth, self-only | `{display_name?, bio?, orcid?, is_pseudonym?}` | `200 {user: PublicUser}` (403 if not self) |
| GET | `/api/users/:id/works` | public | `?limit&offset` | `200 Paginated<WorkSummary>` (works where user is an author) |
| GET | `/api/users/:id/reviews` | public | `?limit&offset` | `200 Paginated<WorkSummary>` (`kind='review'` works authored by user) |

### 13.3 `routes/works.ts` (works, versions, subunits, authorships)

| Method | Path | Auth | Request body | Response | Notable errors |
|---|---|---|---|---|---|
| POST | `/api/works` | auth | `{kind, result_nature?, editing, title, abstract, sections, references, license, authors?: [{user_id?,author_id?,position,credit_roles}]}` | `201 {work: WorkDetail}` | 422 `LICENSE_GATE` if tier A and `sections.length>0` |
| GET | `/api/works` | public | `?kind&result_nature&tier&source&editing&q&limit&offset&sort=recent|title` | `200 Paginated<WorkSummary>` | — |
| GET | `/api/works/:id` | public | — | `200 {work: WorkDetail}` | 404 |
| PATCH | `/api/works/:id` | auth, edit-permission | `{change_note, title?, abstract?, sections?, references?, license?}` (unset fields carry over from current version) | `200 {work: WorkDetail}` | 403 if authored & not an author; 422 `LICENSE_GATE`; 409 `CONFLICT` tier downgrade with existing subunits |
| POST | `/api/works/:id/revert` | auth, edit-permission | `{version_id, change_note?}` | `201 {work: WorkDetail}` (new version, content copied byte-for-byte from `version_id`) | 404 unknown `version_id` for this work |
| GET | `/api/works/:id/versions` | public | `?limit&offset` | `200 Paginated<WorkVersion>` | — |
| GET | `/api/works/:id/subunits` | public | — | `200 {items: Subunit[]}` (`[]` if tier != C) | — |
| POST | `/api/works/:id/subunits` | auth, edit-permission | `{type, title?, content, order_index?}` | `201 {subunit: Subunit}` | 403 `LICENSE_GATE` if tier != C |
| GET | `/api/works/:id/authors` | public | — | `200 {items: Authorship[]}` | — |
| POST | `/api/works/:id/authors` | auth, edit-permission | `{user_id?, author_id?, position, credit_roles: CreditRole[]}` (exactly one of `user_id`/`author_id`) | `201 {authorship: Authorship}` | 400 if neither/both id supplied |

Concept nodes: `POST /api/works` with `kind:'concept'` forces `editing:'communal'` server-side regardless of the request body's `editing` value (matches the DB `CHECK`); the route does not error if the client sent `'authored'`, it silently corrects it and the response reflects the corrected value.

### 13.4 `routes/edges.ts`

| Method | Path | Auth | Request body | Response | Notable errors |
|---|---|---|---|---|---|
| POST | `/api/edges` | auth | `{source_work_id, target_work_id, source_subunit_id?, target_subunit_id?, type, basis?}` | `201 {edge: EdgeDetail}` — created `origin:'human', status:'confirmed'` | 400 self-loop; 404 unknown work id |
| GET | `/api/edges/:id` | public | — | `200 {edge: EdgeDetail}` | 404 |
| GET | `/api/works/:id/edges` | public | `?direction=out|in|both&type=csv&status=csv&include_ai=bool` | `200 {items: EdgeDetail[]}` | — |
| POST | `/api/edges/:id/confirm` | auth | — | `200 {edge: EdgeDetail}` | 422 `INVALID_TRANSITION` unless status in `{suggested,disputed}` |
| POST | `/api/edges/:id/dispute` | auth | `{comment?}` | `200 {edge: EdgeDetail}` | 422 unless status `confirmed` |
| POST | `/api/edges/:id/reject` | auth | `{comment?}` | `200 {edge: EdgeDetail}` | 422 unless status in `{suggested,disputed}` |
| POST | `/api/edges/:id/vote` | auth | `{vote: 1 or -1, comment?}` | `200 {edge: EdgeDetail}` (upserts on `(edge_id,user_id)`) | 400 invalid vote value |

### 13.5 `routes/reviews.ts` (review-as-work convenience + granular comments)

| Method | Path | Auth | Request body | Response | Notable errors |
|---|---|---|---|---|---|
| POST | `/api/works/:id/reviews` | auth | `{title, abstract, sections, references, license, result_nature?}` | `201 {review: WorkDetail, edge: EdgeDetail}` — atomically creates a `kind:'review', editing:'authored'` work + a `type:'reviews'` edge (`source`=new review, `target`=`:id`, `origin:'human', status:'confirmed'`) | 404 target work not found |
| GET | `/api/works/:id/reviews` | public | `?limit&offset` | `200 Paginated<WorkSummary>` (works linked via confirmed `reviews` edges targeting `:id`) | — |
| GET | `/api/works/:id/comments` | public | `?subunit_id` | `200 {items: Comment[]}` (threaded: client nests by `parent_id`) | — |
| POST | `/api/works/:id/comments` | auth | `{body, subunit_id?, parent_id?}` | `201 {comment: Comment}` | 404 unknown `parent_id`/`subunit_id` |
| PATCH | `/api/comments/:id` | auth, author-only | `{body}` | `200 {comment: Comment}` | 403 not the comment's author |
| DELETE | `/api/comments/:id` | auth, author-only | — | `204` (soft delete: `deleted_at` set, `body` replaced with `'[deleted]'`) | 403 |

### 13.6 `routes/ai.ts`

| Method | Path | Auth | Request body | Response | Notable errors |
|---|---|---|---|---|---|
| POST | `/api/works/:id/ai/suggest-edges` | auth | — | `201 {items: EdgeDetail[]}` — inserts `origin:'ai', status:'suggested'` edges from `provider.suggestEdges` | — |
| POST | `/api/works/:id/ai/summarize` | auth | — | `201 {output: AiOutput}` — `scope` auto-selected via `canAiTransformFullText(work.tier)` | — |
| POST | `/api/works/:id/ai/glossary` | auth | — | `201 {output: AiOutput}` (`content` = JSON-stringified `GlossaryEntry[]`) | — |
| POST | `/api/works/:id/ai/explain` | auth | `{question, subunit_id?}` | `201 {output: AiOutput}` (`content` = JSON-stringified `ExplainerContent`) | — |
| GET | `/api/works/:id/ai` | public | `?feature=summary|glossary|explainer` | `200 {items: AiOutput[]}` (only `is_current=1` rows) | — |
| PATCH | `/api/ai/:id` | auth | `{content}` | `200 {output: AiOutput}` — inserts a new row (`previous_output_id` = old id, `is_current=1`, old row's `is_current` set `0`), `status` reset to `'active'` if it was `'flagged'` | 403 if target `status='removed'` |

### 13.7 `routes/flags.ts`

| Method | Path | Auth | Request body | Response | Notable errors |
|---|---|---|---|---|---|
| POST | `/api/flags` | auth | `{target_type: 'ai_output'|'edge', target_id, reason}` | `201 {flag: Flag}` — if `target_type='ai_output'`, also sets that `ai_outputs.status='flagged'` | 404 unknown target |
| GET | `/api/flags` | admin | `?status=open&target_type=` | `200 Paginated<Flag>` | — |
| POST | `/api/flags/:id/resolve` | admin | `{status: 'upheld'|'dismissed', resolution_note, action?: 'remove'|'keep'}` | `200 {flag: Flag}` — `dismissed`: target `ai_output` reverts `status='active'`. `upheld`+`action='remove'`: `ai_output.status='removed'` or `edge.status='rejected'`. `upheld`+`action='keep'`: target stays `'flagged'` pending a correcting `PATCH /api/ai/:id` | 422 already resolved |
| GET | `/api/ai/track-record` | public | `?feature=` | `200 {items: AccuracyTrackRecord[]}` — per-`feature`, counts of `flags` (`target_type='ai_output'`, joined to `ai_outputs.feature`) grouped by `status` | — |

### 13.8 `routes/search.ts`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/search` | public | `?q&kind&result_nature&tier&limit&offset` | `200 SearchResponse` — see §8 for scoring |

### 13.9 `routes/import.ts`

| Method | Path | Auth | Request body | Response | Notable errors |
|---|---|---|---|---|---|
| POST | `/api/import/doi` | auth | `{doi}` | `201 or 200 ImportResult` (`200` when `created:false`, deduped) | 502 upstream Crossref failure |
| POST | `/api/import/arxiv` | auth | `{arxiv_id}` | `201 or 200 ImportResult` | 502 upstream arXiv failure |
| POST | `/api/import/openalex` | auth | `{openalex_id}` (single) or `{query, limit?<=50}` (batch) | single: `201/200 ImportResult`; batch: `200 {items: ImportResult[]}` | 400 neither `openalex_id` nor `query` given |

### 13.10 `routes/export.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/works/:id/export/latex` | public | `application/x-latex` file, see §9 |
| GET | `/api/works/:id/export/bibtex` | public | `application/x-bibtex` file, see §9 |
| GET | `/api/works/:id/export/json` | public | `200` Crossref-like JSON, see §9 |
| GET | `/api/versions/:hash` | public | `200 {matches: [...]}`, see §9 (404 if empty) |

### 13.11 `routes/graph.ts`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/graph/:workId` | public | `?depth=1..3&types=csv&direction=ancestors|descendants|both&include_ai=bool` | `200 GraphResponse`, see §11 |
| GET | `/api/graph` | public | `?types=csv&include_ai=bool` | `200 GraphResponse` (`root_id: null`), field-wide overview, see §11 |

### 13.12 `routes/chats.ts` (uploaded AI conversations)

Visibility rule: `pending` chats 404 for everyone but their uploader (and admins). Uploader-only actions return 403 `FORBIDDEN` for other authenticated users.

| Method | Path | Auth | Request body | Response | Notable errors |
|---|---|---|---|---|---|
| POST | `/api/chats` | auth | `{transcript, title?, url?, platform?}` (transcript 40–500 000 chars) | `201 {chat: ChatDetail}` — matcher runs inline, suggestions included | 400 `VALIDATION_ERROR` |
| GET | `/api/chats` | public | `?mine=true&limit&offset` (`mine` requires auth) | `200 Paginated<ChatSummary>` — verified only unless `mine` | |
| GET | `/api/chats/:id` | public* | | `200 {chat: ChatDetail}` | 404 if pending & not uploader |
| POST | `/api/chats/:id/links` | uploader | `{work_id}` | `201 {chat}` — human-origin, instantly confirmed; re-adding a suggested/rejected link confirms it | 404 work |
| POST | `/api/chats/:id/links/:linkId/confirm` | uploader | | `200 {chat}` | 422 `INVALID_TRANSITION` if already confirmed |
| POST | `/api/chats/:id/links/:linkId/reject` | uploader | | `200 {chat}` | 422 if already rejected |
| POST | `/api/chats/:id/verify` | uploader | | `200 {chat}` (status `verified`) | 422 while any link is still `suggested`, or already verified |
| DELETE | `/api/chats/:id` | uploader/admin | | `204` | |
| GET | `/api/works/:id/chats` | public | | `200 {items: WorkChat[]}` — confirmed links of verified chats only | 404 work |

## 14. Error Model — `server/src/lib/errors.ts`

```ts
export class AppError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) { super(message); }
}
```

A single Express error-handling middleware (registered last in `index.ts`) catches `AppError` and serializes `{error:{code,message,details}}` with `statusCode`; unrecognized thrown errors are logged and serialized as `500 {error:{code:'INTERNAL',message:'Internal server error'}}` (never leak stack traces to the client). All route handlers are `async` and wrapped so rejected promises reach this middleware (either a small `wrapAsync(fn)` helper around each handler, or Express 5-style automatic forwarding — since this spec pins **Express 4**, use the explicit `wrapAsync` wrapper).

## 15. Invariants

These must hold after every request, verified by tests, not just by code review:

1. **Licensing boundary.** `works.tier` and `work_versions.license`'s implied tier are always derived via `licenseToTier()`, never accepted as client input. No `subunits` row exists for a work whose current tier is not `C`. No `work_versions.content_json.sections` is non-empty for a work whose *that version's* license resolves to tier `A`. No AI provider call ever receives `sections` content for a version whose license resolves to tier `A` or `B`.
2. **AI trust boundary.** Every `edges` row with `origin='ai'` has non-null `model`, `model_version`, `confidence` (DB-enforced). Every such row's *initial* `status` is `'suggested'` (enforced in the insert path — never insert an AI edge pre-confirmed). `GET /api/graph/*` and any rigor/review/ranking computation exclude `status='suggested'` rows unless `include_ai=true` is explicit, and always exclude `status='rejected'`. `ai_outputs` rows never appear in `edges`, `rigor_raw`, or `review_count_raw`.
3. **Immutability & content-addressing.** `work_versions` and `subunits` rows are only ever `INSERT`ed, never `UPDATE`d or `DELETE`d by application code (schema-level: no route handler issues `UPDATE work_versions` or `UPDATE subunits` — grep for this in review). Every edit (`PATCH /api/works/:id`, `revert`) produces a new `work_versions` row with a freshly computed `content_hash`; `works.current_version_id` is repointed, the old row is untouched and remains resolvable via `GET /api/versions/:hash`.
4. **Attribution.** Every `work_versions`, `subunits`, `edges` (human), `comments`, and `ai_outputs` edit row carries a `created_by`/`asserted_by_user`/`author_user_id`/`edited_by` pointing at the acting user (nullable only where explicitly documented: imported works' `created_by`, AI-original `ai_outputs.edited_by`).
5. **Dedup.** No two `works` rows share a non-null `doi`, `arxiv_id`, or `openalex_id` (DB `UNIQUE` enforced). Re-importing the same external id never creates a second row.
6. **No engagement metrics.** No column anywhere in `schema.sql` stores view counts, likes, follower counts, or share counts; `ranking.ts`'s `WEIGHTS` never reference such a field.

## 16. Known MVP Simplifications (explicit, not accidental)

- **`users.is_admin`** is an architect-added column, not in the original decision list — necessary for the flag-resolution workflow (§4.5/§9.3) to be implementable at all. It is a single boolean gate, not a role system; promotable later.
- **"Qualified human" (§4.2)** is realized as "any authenticated user" for edge `confirm`/`dispute`/`reject` — no reputation-weighting exists yet (§9 is explicitly deferred by the Requirements doc's closing paragraph). `edge_votes` exists so a lightweight signal is captured from day one even though it doesn't yet gate anything automatically.
- **Dedup is conservative:** only exact external-id or exact-normalized-title matches merge; no fuzzy/near-duplicate detection. False negatives (missed duplicates) are preferred over false positives (wrongly merged distinct works).
- **`explainer` AI outputs are stored and publicly visible**, not per-viewer-private, since no per-viewer scoping column exists in `ai_outputs`. §4.7's "different trust tier" is realized through UI labeling/prominence, not storage isolation.
- **ORCID validation is format-only** (regex), not checksum-verified (ISO 7064 mod 11-2).
- **No PDF/LaTeX import parsing** — importers are metadata-API only (Crossref/arXiv/OpenAlex REST). PubMed import is listed in the target route surface for future work but not required for MVP launch; do not build a `pubmed.ts` importer unless asked — `source:'pubmed'` exists in the enum for works ingested by some future importer or manual entry only.
- **No moderator/reputation-gated review capacity (§5.3)** — any authenticated user can write a review; capacity/incentive mechanics beyond CRediT credit are deferred.

## 17. Environment Variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Express listen port |
| `NODE_ENV` | `development` | `production` enables secure cookies + static client serving |
| `DB_PATH` | `data/beyond.db` | SQLite file location |
| `AI_PROVIDER` | `heuristic` | `heuristic` \| `anthropic` |
| `ANTHROPIC_API_KEY` | — | required if `AI_PROVIDER=anthropic`; fail fast at boot if missing |
| `SESSION_TTL_DAYS` | `30` | session expiry window |

## 18. QA Testing Checklist

**Licensing boundary**
- [ ] Create a work with `license:'closed'` → tier `A`; attempt `POST .../subunits` → 403 `LICENSE_GATE`.
- [ ] Create a work with `license:'cc-by-nd'` → tier `B`; store non-empty `sections` successfully; attempt `POST .../subunits` → 403; attempt AI summarize → succeeds but only `{title,abstract}` reached the provider (assert via provider call spy/log in tests).
- [ ] Create a work with `license:'cc-by'` → tier `C`; subunit creation succeeds; AI summarize receives full `sections`.
- [ ] Attempt `POST /api/works` with tier-A license and non-empty `sections` → 422.
- [ ] Attempt to `PATCH` a tier-C work's license down to `cc-by-nc` while it has subunits → 409.
- [ ] Import an arXiv id whose `<arxiv:license>` is absent → `arxiv-default` → tier A; import one with a CC-BY link → tier C.
- [ ] `POST /api/import/*` with an NC license (`cc-by-nc*`) → resulting work is always tier A regardless of source's "open access" flag.

**AI trust boundary**
- [ ] `POST .../ai/suggest-edges` → every created edge has `origin:'ai', status:'suggested'`, non-null `model`/`confidence`.
- [ ] Attempt direct DB/route insertion of an AI edge with `status:'confirmed'` → impossible via API (route always forces `'suggested'`); confirm this by code inspection of the insert statement, not just a runtime test.
- [ ] `GET /api/graph/:id` default excludes suggested AI edges; `?include_ai=true` includes them, each still tagged `origin:'ai'`.
- [ ] Confirm an AI edge (`POST .../confirm`) → `status:'confirmed'`, now counted in `rigor`/`review_count` where applicable and included in default graph traversal.
- [ ] `PATCH /api/ai/:id` → old row `is_current:0`, new row references `previous_output_id`, `edited_by` set.
- [ ] Flag an `ai_output` → its `status` becomes `flagged` immediately; admin `resolve` with `dismissed` → reverts to `active`; `upheld`+`remove` → `removed`; `PATCH /api/ai/:id` on a `removed` output → 403.
- [ ] `GET /api/ai/track-record` totals match the sum of resolved flags per feature.

**Immutability & versioning**
- [ ] `PATCH /api/works/:id` never issues an `UPDATE work_versions`; a new row appears with an incremented `version_number`.
- [ ] `content_hash` is stable across re-fetch and independent of `change_note`/`created_at`/`license` changes when title/abstract/sections/references are unchanged.
- [ ] `revert` to an older version reproduces its exact `content_hash` in a brand-new row (own `id`, own `version_number`, own `created_at`); `GET /api/versions/:hash` returns both rows.
- [ ] Editing a `communal` work (concept node) as a non-author succeeds; editing an `authored` work as a non-author → 403.

**Dedup & import**
- [ ] Import the same DOI twice → second call returns `created:false`, no duplicate `works` row, no unique-constraint 500.
- [ ] Import via arXiv id twice with a version bump upstream → a second `work_versions` row is appended, not a new `works` row.

**Search & graph**
- [ ] `GET /api/search` response includes `score_components` and `weights` on every result; components are each within `[0,1]`.
- [ ] A work with more confirmed `supports`/`replicates` edges ranks above an otherwise-identical work with fewer, all else equal.
- [ ] `GET /api/graph/:id?depth=4` → 400; `depth=3` succeeds and never returns more than the documented node/edge caps.

**Auth & permissions**
- [ ] Register/login open to anyone, no invite/approval step.
- [ ] Session cookie round-trips; expired session → 401 on protected routes.
- [ ] `requireAdmin`-only routes (`GET /api/flags`, `POST /api/flags/:id/resolve`) reject non-admin authenticated users with 403.

**Export**
- [ ] LaTeX/BibTeX/JSON export succeeds for a tier-A work (metadata+abstract only, empty sections) without error.
- [ ] Exported LaTeX compiles (or at minimum parses) as valid LaTeX for a tier-C work with multiple sections and references.

## 19. Implementation Deviations (scaffold-level, authoritative)

The as-built scaffold deviates from §3/§4/§6 in these small, deliberate ways — implementers follow **this** section where it conflicts:

1. **`edges` has `UNIQUE (source_work_id, target_work_id, type)`** — prevents duplicate-edge spam (§9 spirit). Routes must handle it: `POST /api/edges` on an existing triple → if the existing edge is `suggested` (AI), promote it as if confirmed by the caller and return 200; otherwise 409 `CONFLICT`. AI suggest-edges must skip triples that already exist.
2. **`works.publication_year INTEGER` column exists** (nullable) — set by importers; used for display and BibTeX `year` (fallback: `created_at` year). Recency ranking still uses `created_at` per §8.
3. **Password fns live in `lib/auth.ts`**, not `hash.ts` (`lib/hash.ts` holds `canonicalJson`/`sha256Hex`/`contentHash` only).
4. **Auth token transport:** cookie `session_token` (checked first) **or** `Authorization: Bearer <token>` — the SPA client uses the Bearer header with localStorage. Response key is `session_token` as spec'd.
5. **Auth middleware:** a global `optionalAuth` resolves the session on every request; `requireAuth`/`requireAdmin` then just check `req.user`. Same behavior as spec §6, different wiring.
6. **`shared/types.ts` extras:** exported const arrays `EDGE_TYPES`, `CREDIT_ROLES`, `SUBUNIT_TYPES`, `LICENSE_IDS` and the `licenseToTier` fn (client needs them for form options); `EdgeDetail` also carries optional `source_title`/`target_title` for list rendering; `WorkDetail.current_version` is nullable (imported Tier-A stubs). `PublicUser = User`.
7. **Error helper names** (`lib/errors.ts`): `validationError`, `unauthorized`, `forbidden`, `licenseGate(msg, status?)`, `notFound`, `conflict`, `invalidTransition`, `upstreamError`, plus `wrapAsync`. Class name is `AppError`.
8. **FTS triggers** fire `AFTER UPDATE OF title, abstract` (not on every UPDATE) — same semantics, less churn.
