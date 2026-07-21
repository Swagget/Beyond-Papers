// OpenAlex importer (spec §10, §13.9, §3.1).
// single: GET https://api.openalex.org/works/{Wxxxx}
// batch:  GET https://api.openalex.org/works?search={query}&per-page={limit<=50}
// search: GET https://api.openalex.org/works?search={query}&select=... (read-only, no import)
// cites:  GET https://api.openalex.org/works?filter=cites:{Wxxxx}&sort=cited_by_count:desc

import { db } from '../../db.js';
import { notFound, upstreamError, validationError } from '../../lib/errors.js';
import { normalizeLicense } from '../../lib/license.js';
import { createWork, getWorkDetail, type AuthorshipInput } from '../workStore.js';
import { findExisting, backfillIds, normalizeDoi, normalizeOpenalexId, resolveAuthorId } from '../dedup.js';
import type { ExternalSearchHit, ImportResult, LicenseId, NeighborhoodSummary } from '../../../../shared/types.js';

const USER_AGENT = 'BeyondPapers/0.1 (research-graph; mailto:admin@example.org)';

/** Max works imported per one-hop neighborhood (inbound citers + outbound refs combined). */
const NEIGHBOR_CAP = 20;
/** Ideal per-side share of the cap; the other side backfills unused slots. */
const NEIGHBOR_SIDE = NEIGHBOR_CAP / 2;
/** OpenAlex OR-pipe filters accept at most 50 values; we fetch at most 2 chunks (100 refs). */
const REF_CHUNK = 50;
const MAX_REF_CHUNKS = 2;

/** Result of an OpenAlex import also carries referenced-work ids for the seed script to
 * turn into 'cites' edges under a system user — see decision note below. */
export type OpenalexImportResult = ImportResult & { cited_openalex_ids?: string[] };

interface OpenalexAuthorship {
  author?: { id?: string; display_name?: string; orcid?: string | null };
}

interface OpenalexWork {
  id: string;
  doi?: string | null;
  display_name?: string;
  title?: string;
  publication_year?: number | null;
  primary_location?: { license?: string | null } | null;
  authorships?: OpenalexAuthorship[];
  abstract_inverted_index?: Record<string, number[]> | null;
  referenced_works?: string[];
  cited_by_count?: number;
}

/** GET an OpenAlex API url with the shared politeness headers, timeout, and error mapping.
 * Appends mailto= for the polite pool when OPENALEX_MAILTO is set. */
async function fetchOpenalex(url: string): Promise<Response> {
  const mailto = process.env.OPENALEX_MAILTO;
  const full = mailto ? `${url}${url.includes('?') ? '&' : '?'}mailto=${encodeURIComponent(mailto)}` : url;
  let res: Response;
  try {
    res = await fetch(full, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw upstreamError(`OpenAlex request failed: ${(err as Error).message}`);
  }
  return res;
}

/** Rebuild plain-text abstract from OpenAlex's {word: [positions]} inverted index. */
function deinvertAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const positions: string[] = [];
  for (const [word, idxs] of Object.entries(index)) {
    for (const idx of idxs) positions[idx] = word;
  }
  const text = positions.filter((w) => w !== undefined).join(' ').trim();
  return text.length > 0 ? text : null;
}

interface MappedWork {
  title: string;
  abstract: string | null;
  doi: string | null;
  openalexId: string;
  license: LicenseId;
  publicationYear: number | null;
  authors: AuthorshipInput[];
  citedOpenalexIds: string[];
}

function mapWork(raw: OpenalexWork): MappedWork {
  const title = (raw.display_name ?? raw.title ?? '').trim();
  const abstract = deinvertAbstract(raw.abstract_inverted_index);
  const doi = raw.doi ? normalizeDoi(raw.doi) : null;
  const openalexId = normalizeOpenalexId(raw.id);
  // OpenAlex already uses short codes (cc-by, cc-by-nc, cc0, ...); normalizeLicense passes
  // a recognized code through unchanged. NC codes therefore resolve to Tier A automatically
  // via licenseToTier — open_access flags are never consulted (§3.1).
  const license = normalizeLicense(raw.primary_location?.license ?? null);
  const publicationYear = raw.publication_year ?? null;

  const authors: AuthorshipInput[] = (raw.authorships ?? []).map((a, i) => {
    const fullName = a.author?.display_name ?? 'Unknown author';
    const openalexAuthorId = a.author?.id ?? null;
    const orcid = a.author?.orcid ?? null;
    const authorId = resolveAuthorId({ full_name: fullName, orcid, openalex_author_id: openalexAuthorId });
    return { position: i + 1, author_id: authorId, credit_roles: [] };
  });

  const citedOpenalexIds = (raw.referenced_works ?? []).map((w) => normalizeOpenalexId(w));

  return { title, abstract, doi, openalexId, license, publicationYear, authors, citedOpenalexIds };
}

export function importFromRaw(raw: OpenalexWork): OpenalexImportResult {
  const mapped = mapWork(raw);

  const existing = findExisting({ doi: mapped.doi, openalex_id: mapped.openalexId, title: mapped.title });
  if (existing) {
    backfillIds(existing, { doi: mapped.doi, openalex_id: mapped.openalexId });
    return { work: getWorkDetail(existing.id)!, created: false, cited_openalex_ids: mapped.citedOpenalexIds };
  }

  // OpenAlex's works endpoint exposes metadata only, not full text — sections always [] (§10).
  const work = createWork({
    kind: 'paper',
    source: 'openalex',
    created_by: null,
    title: mapped.title,
    abstract: mapped.abstract,
    sections: [],
    references: [],
    license: mapped.license,
    doi: mapped.doi,
    openalex_id: mapped.openalexId,
    publication_year: mapped.publicationYear,
    authors: mapped.authors,
    change_note: 'Imported from OpenAlex',
  });

  return { work, created: true, cited_openalex_ids: mapped.citedOpenalexIds };
}

export async function importOpenalexWork(openalexIdRaw: string): Promise<OpenalexImportResult> {
  const openalexId = normalizeOpenalexId(openalexIdRaw);

  const res = await fetchOpenalex(`https://api.openalex.org/works/${encodeURIComponent(openalexId)}`);
  if (res.status === 404) throw notFound('OpenAlex work not found');
  if (!res.ok) throw upstreamError(`OpenAlex API returned ${res.status}`);

  const raw = (await res.json()) as OpenalexWork;
  return importFromRaw(raw);
}

export async function importOpenalexBatch(query: string, limit = 20): Promise<OpenalexImportResult[]> {
  if (limit > 50) throw validationError('limit must be <= 50');
  const perPage = Math.max(1, Math.min(50, Math.trunc(limit) || 20));

  const res = await fetchOpenalex(
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${perPage}`,
  );
  if (!res.ok) throw upstreamError(`OpenAlex API returned ${res.status}`);

  const body = (await res.json()) as { results?: OpenalexWork[] };
  return (body.results ?? []).map((raw) => importFromRaw(raw));
}

// ---------- read-only external search (no import side effect) ----------

/** Search OpenAlex without persisting anything; each hit is marked with the local work id
 * when an exact external-id (DOI / OpenAlex id) already matches a corpus row. */
export async function searchOpenalexExternal(query: string, limit: number): Promise<ExternalSearchHit[]> {
  const perPage = Math.max(1, Math.min(25, Math.trunc(limit) || 10));
  const select = 'id,doi,display_name,title,publication_year,authorships,cited_by_count';
  const res = await fetchOpenalex(
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${perPage}&select=${select}`,
  );
  if (!res.ok) throw upstreamError(`OpenAlex API returned ${res.status}`);

  const body = (await res.json()) as { results?: OpenalexWork[] };
  return (body.results ?? [])
    .filter((raw) => (raw.display_name ?? raw.title ?? '').trim().length > 0)
    .map((raw) => {
      const doi = raw.doi ? normalizeDoi(raw.doi) : null;
      const openalexId = normalizeOpenalexId(raw.id);
      const existing = findExisting({ doi, openalex_id: openalexId });
      return {
        openalex_id: openalexId,
        doi,
        title: (raw.display_name ?? raw.title ?? '').trim(),
        publication_year: raw.publication_year ?? null,
        authors: (raw.authorships ?? [])
          .slice(0, 4)
          .map((a) => a.author?.display_name ?? 'Unknown author'),
        cited_by_count: raw.cited_by_count ?? 0,
        existing_work_id: existing ? existing.id : null,
      };
    });
}

// ---------- one-hop neighborhood import ----------

const insertCitesEdge = db.prepare(
  `INSERT OR IGNORE INTO edges (source_work_id, target_work_id, type, origin, asserted_by_user, basis, status, confirmed_by, confirmed_at)
   VALUES (?, ?, 'cites', 'human', ?, ?, 'confirmed', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
);

/** Insert a confirmed cites edge (source cites target); returns 1 if inserted, 0 if it already existed. */
function addCitesEdge(sourceWorkId: number, targetWorkId: number, userId: number, basis: string): number {
  if (sourceWorkId === targetWorkId) return 0;
  return insertCitesEdge.run(sourceWorkId, targetWorkId, userId, basis, userId).changes;
}

/** Fetch full OpenAlex records for a set of ids via OR-pipe filters (chunks of 50, capped). */
async function fetchWorksByIds(ids: string[]): Promise<OpenalexWork[]> {
  const out: OpenalexWork[] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length && chunks.length < MAX_REF_CHUNKS; i += REF_CHUNK) {
    chunks.push(ids.slice(i, i + REF_CHUNK));
  }
  for (const chunk of chunks) {
    const filter = `openalex_id:${chunk.join('|')}`;
    const res = await fetchOpenalex(
      `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}&per-page=${REF_CHUNK}`,
    );
    if (!res.ok) throw upstreamError(`OpenAlex API returned ${res.status}`);
    const body = (await res.json()) as { results?: OpenalexWork[] };
    out.push(...(body.results ?? []));
  }
  return out;
}

/** Papers citing the given work, most-cited first (full records, importable). */
async function fetchCitingWorks(openalexId: string, limit: number): Promise<OpenalexWork[]> {
  const res = await fetchOpenalex(
    `https://api.openalex.org/works?filter=cites:${encodeURIComponent(openalexId)}&sort=cited_by_count:desc&per-page=${limit}`,
  );
  if (!res.ok) throw upstreamError(`OpenAlex API returned ${res.status}`);
  const body = (await res.json()) as { results?: OpenalexWork[] };
  return body.results ?? [];
}

/**
 * Import a work plus its one-hop citation neighborhood: up to NEIGHBOR_CAP most-cited
 * neighbors (papers citing it + papers it cites), with confirmed 'cites' edges.
 * Works the center cites that are ALREADY in the corpus get edges even beyond the cap.
 */
export async function importOpenalexWithConnections(
  openalexIdRaw: string,
  userId: number,
): Promise<OpenalexImportResult & { neighborhood: NeighborhoodSummary }> {
  const center = await importOpenalexWork(openalexIdRaw);
  const centerId = center.work.id;
  const centerOpenalexId = normalizeOpenalexId(openalexIdRaw);
  const refIds = (center.cited_openalex_ids ?? []).filter((id) => id !== centerOpenalexId);

  const summary: NeighborhoodSummary = { imported: 0, linked_existing: 0, edges_created: 0 };

  // Free edges first: refs already in the corpus, regardless of the import cap.
  const alreadyImportedRefs = new Set<string>();
  for (let i = 0; i < refIds.length; i += REF_CHUNK) {
    const chunk = refIds.slice(i, i + REF_CHUNK);
    const rows = db
      .prepare(`SELECT id, openalex_id FROM works WHERE openalex_id IN (${chunk.map(() => '?').join(',')})`)
      .all(...chunk) as Array<{ id: number; openalex_id: string }>;
    for (const row of rows) {
      alreadyImportedRefs.add(row.openalex_id);
      summary.edges_created += addCitesEdge(centerId, row.id, userId, 'OpenAlex referenced_works metadata');
    }
  }

  // Inbound citers (already sorted by cited_by_count desc) — fetch a full pool so
  // unused outbound slots can backfill from here.
  let citing: OpenalexWork[] = [];
  try {
    citing = (await fetchCitingWorks(centerOpenalexId, NEIGHBOR_CAP)).filter(
      (raw) => normalizeOpenalexId(raw.id) !== centerOpenalexId,
    );
  } catch (err) {
    console.warn(`[import] citing-works fetch failed for ${centerOpenalexId}: ${(err as Error).message}`);
  }

  // Outbound refs arrive as bare ids — batch-fetch (first 100) to rank by cited_by_count.
  let refs: OpenalexWork[] = [];
  try {
    const newRefIds = refIds.filter((id) => !alreadyImportedRefs.has(id));
    refs = (await fetchWorksByIds(newRefIds)).sort((a, b) => (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0));
  } catch (err) {
    console.warn(`[import] referenced-works fetch failed for ${centerOpenalexId}: ${(err as Error).message}`);
  }

  // Split the cap between sides; whichever side has spare candidates backfills.
  const citingTake = Math.min(citing.length, NEIGHBOR_SIDE + Math.max(0, NEIGHBOR_SIDE - refs.length));
  const refsTake = Math.min(refs.length, NEIGHBOR_CAP - Math.min(citing.length, citingTake));
  const pickedCiting = citing.slice(0, citingTake);
  const pickedRefs = refs.slice(0, refsTake);

  const importNeighbor = (raw: OpenalexWork): number | null => {
    try {
      const result = importFromRaw(raw);
      if (result.created) summary.imported += 1;
      else summary.linked_existing += 1;
      return result.work.id;
    } catch (err) {
      console.warn(`[import] neighbor ${raw.id} failed: ${(err as Error).message}`);
      return null;
    }
  };

  for (const raw of pickedRefs) {
    const id = importNeighbor(raw);
    if (id !== null) summary.edges_created += addCitesEdge(centerId, id, userId, 'OpenAlex referenced_works metadata');
  }
  for (const raw of pickedCiting) {
    const id = importNeighbor(raw);
    if (id !== null) summary.edges_created += addCitesEdge(id, centerId, userId, 'OpenAlex citing-works metadata');
  }

  return { ...center, neighborhood: summary };
}
