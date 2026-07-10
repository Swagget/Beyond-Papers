// Crossref DOI importer (spec §10, §13.9).
// GET https://api.crossref.org/works/{doi}

import { notFound, upstreamError } from '../../lib/errors.js';
import { normalizeLicense } from '../../lib/license.js';
import { createWork, getWorkDetail, type AuthorshipInput } from '../workStore.js';
import { findExisting, backfillIds, normalizeDoi, normalizeOrcid, resolveAuthorId } from '../dedup.js';
import type { ImportResult, LicenseId } from '../../../../shared/types.js';

const USER_AGENT = 'BeyondPapers/0.1 (research-graph; mailto:admin@example.org)';

interface CrossrefAuthor {
  given?: string;
  family?: string;
  name?: string; // organizations sometimes use 'name' instead of given/family
  ORCID?: string;
}

interface CrossrefDateParts {
  'date-parts'?: number[][];
}

interface CrossrefMessage {
  title?: string[];
  author?: CrossrefAuthor[];
  license?: Array<{ URL?: string }>;
  published?: CrossrefDateParts;
  'published-print'?: CrossrefDateParts;
  'published-online'?: CrossrefDateParts;
  issued?: CrossrefDateParts;
  abstract?: string;
}

/** Strip JATS markup (<jats:p>...</jats:p> etc.) that Crossref sometimes wraps abstracts in. */
function stripJats(input: string): string {
  return input
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function importDoi(doiRaw: string): Promise<ImportResult> {
  const doi = normalizeDoi(doiRaw);

  let res: Response;
  try {
    res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw upstreamError(`Crossref request failed: ${(err as Error).message}`);
  }
  if (res.status === 404) throw notFound('DOI not found');
  if (!res.ok) throw upstreamError(`Crossref API returned ${res.status}`);

  const body = (await res.json()) as { message: CrossrefMessage };
  const message = body.message;

  const title = (message.title?.[0] ?? doi).trim();
  const abstract = message.abstract ? stripJats(message.abstract) : null;

  // §10 license table: first license[] URL wins; no license array at all -> 'unknown' (the
  // safe Tier-A default — Crossref's "explicit TDM-restricted, no license array -> closed"
  // case is not distinguishable from a plain absent license via this endpoint alone).
  const licenseUrl = message.license?.[0]?.URL ?? null;
  const license: LicenseId = normalizeLicense(licenseUrl);

  const dateParts =
    message.published?.['date-parts']?.[0] ??
    message['published-print']?.['date-parts']?.[0] ??
    message['published-online']?.['date-parts']?.[0] ??
    message.issued?.['date-parts']?.[0];
  const publicationYear = dateParts?.[0] ?? null;

  const authors: AuthorshipInput[] = (message.author ?? []).map((a, i) => {
    const fullName = (a.name ?? [a.given, a.family].filter(Boolean).join(' ').trim()) || 'Unknown author';
    const orcid = a.ORCID ? normalizeOrcid(a.ORCID) : null;
    const authorId = resolveAuthorId({ full_name: fullName, orcid });
    return { position: i + 1, author_id: authorId, credit_roles: [] };
  });

  const existing = findExisting({ doi, title });
  if (existing) {
    backfillIds(existing, { doi });
    return { work: getWorkDetail(existing.id)!, created: false };
  }

  // Crossref never supplies full text — sections always [] regardless of tier (§10).
  const work = createWork({
    kind: 'paper',
    source: 'crossref',
    created_by: null,
    title,
    abstract,
    sections: [],
    references: [],
    license,
    doi,
    publication_year: publicationYear ?? null,
    authors,
    change_note: 'Imported from Crossref',
  });

  return { work, created: true };
}
