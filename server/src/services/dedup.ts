// External-id + title dedup for importers (spec §10, §15 invariant 5, §16).
// The ONLY module that decides "is this an existing work / existing author" for imports.

import { db } from '../db.js';
import { ORCID_RE } from '../lib/auth.js';
import type { Work } from '../../../shared/types.js';

// ---------- normalization ----------

/** Lowercase; strip a leading 'doi:' or 'https://doi.org/'/'http://dx.doi.org/' prefix. */
export function normalizeDoi(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^doi:\s*/, '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
}

/** Strip an 'arXiv:' prefix, an 'https://arxiv.org/abs/' prefix, and a trailing vN version suffix. */
export function normalizeArxivId(input: string): string {
  return input
    .trim()
    .replace(/^arxiv:/i, '')
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, '')
    .replace(/v\d+$/i, '');
}

/** Strip an 'https://openalex.org/' prefix, leaving the bare id (Wxxxx for works, Axxxx for authors). */
export function normalizeOpenalexId(input: string): string {
  return input.trim().replace(/^https?:\/\/openalex\.org\//i, '');
}

/** Lowercase, strip non-alphanumeric characters, collapse whitespace. Used for fallback dedup only. */
export function normalizeTitle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip an ORCID URL down to bare ####-####-####-###[X] form; null if it doesn't validate. */
export function normalizeOrcid(input: string): string | null {
  const bare = input
    .trim()
    .replace(/^https?:\/\/(www\.)?orcid\.org\//i, '')
    .replace(/\/$/, '');
  return ORCID_RE.test(bare) ? bare : null;
}

// ---------- work dedup ----------

export interface ExternalIds {
  doi?: string | null;
  arxiv_id?: string | null;
  openalex_id?: string | null;
  title?: string;
}

/**
 * Look up an existing work by external id (doi / arxiv_id / openalex_id), exact match only.
 * If none match, falls back to an exact normalized-title check purely to log a
 * possible-duplicate hint — per spec §10/§16 a title collision never auto-merges,
 * the importer still creates a new row, so this branch always returns undefined.
 */
export function findExisting(ids: ExternalIds): Work | undefined {
  if (ids.doi) {
    const row = db.prepare('SELECT * FROM works WHERE doi = ?').get(normalizeDoi(ids.doi)) as Work | undefined;
    if (row) return row;
  }
  if (ids.arxiv_id) {
    const row = db.prepare('SELECT * FROM works WHERE arxiv_id = ?').get(normalizeArxivId(ids.arxiv_id)) as
      | Work
      | undefined;
    if (row) return row;
  }
  if (ids.openalex_id) {
    const row = db.prepare('SELECT * FROM works WHERE openalex_id = ?').get(normalizeOpenalexId(ids.openalex_id)) as
      | Work
      | undefined;
    if (row) return row;
  }

  if (ids.title) {
    const norm = normalizeTitle(ids.title);
    const rows = db.prepare('SELECT id, title FROM works').all() as Array<{ id: number; title: string }>;
    const hit = rows.find((r) => normalizeTitle(r.title) === norm);
    if (hit) {
      console.log(
        `[dedup] possible duplicate: import title matches existing work #${hit.id} ("${hit.title}") ` +
          'after normalization — not auto-merged, creating a new row (spec §10/§16)',
      );
    }
  }

  return undefined;
}

/** Fills missing external-id columns on an existing row from a fresh import (never overwrites a present id). */
export function backfillIds(
  work: Work,
  ids: { doi?: string | null; arxiv_id?: string | null; openalex_id?: string | null },
): void {
  db.prepare(
    `UPDATE works SET
       doi = COALESCE(doi, ?),
       arxiv_id = COALESCE(arxiv_id, ?),
       openalex_id = COALESCE(openalex_id, ?)
     WHERE id = ?`,
  ).run(
    ids.doi ? normalizeDoi(ids.doi) : null,
    ids.arxiv_id ? normalizeArxivId(ids.arxiv_id) : null,
    ids.openalex_id ? normalizeOpenalexId(ids.openalex_id) : null,
    work.id,
  );
}

// ---------- author dedup ----------

export interface AuthorIdentity {
  full_name: string;
  orcid?: string | null;
  openalex_author_id?: string | null;
}

/**
 * Resolve (or create) an `authors` row for an imported author, preferring the strongest
 * identifier available: openalex_author_id, then orcid, then an exact full_name match,
 * else create a new row. Mirrors §10's "keyed by orcid via INSERT OR IGNORE then lookup,
 * else match full_name exact, else create" for Crossref, extended with OpenAlex's own id.
 */
export function resolveAuthorId(identity: AuthorIdentity): number {
  const openalexAuthorId = identity.openalex_author_id ? normalizeOpenalexId(identity.openalex_author_id) : null;
  const orcid = identity.orcid ? normalizeOrcid(identity.orcid) : null;
  const fullName = identity.full_name.trim() || 'Unknown author';

  if (openalexAuthorId) {
    db.prepare('INSERT OR IGNORE INTO authors (full_name, openalex_author_id) VALUES (?, ?)').run(
      fullName,
      openalexAuthorId,
    );
    const row = db.prepare('SELECT id FROM authors WHERE openalex_author_id = ?').get(openalexAuthorId) as {
      id: number;
    };
    return row.id;
  }
  if (orcid) {
    db.prepare('INSERT OR IGNORE INTO authors (full_name, orcid) VALUES (?, ?)').run(fullName, orcid);
    const row = db.prepare('SELECT id FROM authors WHERE orcid = ?').get(orcid) as { id: number };
    return row.id;
  }
  const existing = db.prepare('SELECT id FROM authors WHERE full_name = ?').get(fullName) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const res = db.prepare('INSERT INTO authors (full_name) VALUES (?)').run(fullName);
  return Number(res.lastInsertRowid);
}
