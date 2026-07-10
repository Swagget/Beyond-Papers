// OpenAlex importer (spec §10, §13.9, §3.1).
// single: GET https://api.openalex.org/works/{Wxxxx}
// batch:  GET https://api.openalex.org/works?search={query}&per-page={limit<=50}

import { notFound, upstreamError, validationError } from '../../lib/errors.js';
import { normalizeLicense } from '../../lib/license.js';
import { createWork, getWorkDetail, type AuthorshipInput } from '../workStore.js';
import { findExisting, backfillIds, normalizeDoi, normalizeOpenalexId, resolveAuthorId } from '../dedup.js';
import type { ImportResult, LicenseId } from '../../../../shared/types.js';

const USER_AGENT = 'BeyondPapers/0.1 (research-graph; mailto:admin@example.org)';

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

function importFromRaw(raw: OpenalexWork): OpenalexImportResult {
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

  let res: Response;
  try {
    res = await fetch(`https://api.openalex.org/works/${encodeURIComponent(openalexId)}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw upstreamError(`OpenAlex request failed: ${(err as Error).message}`);
  }
  if (res.status === 404) throw notFound('OpenAlex work not found');
  if (!res.ok) throw upstreamError(`OpenAlex API returned ${res.status}`);

  const raw = (await res.json()) as OpenalexWork;
  return importFromRaw(raw);
}

export async function importOpenalexBatch(query: string, limit = 20): Promise<OpenalexImportResult[]> {
  if (limit > 50) throw validationError('limit must be <= 50');
  const perPage = Math.max(1, Math.min(50, Math.trunc(limit) || 20));

  let res: Response;
  try {
    res = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${perPage}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw upstreamError(`OpenAlex request failed: ${(err as Error).message}`);
  }
  if (!res.ok) throw upstreamError(`OpenAlex API returned ${res.status}`);

  const body = (await res.json()) as { results?: OpenalexWork[] };
  return (body.results ?? []).map((raw) => importFromRaw(raw));
}
