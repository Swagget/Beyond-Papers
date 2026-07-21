// arXiv importer (spec §10, §13.9, §3.6).
// GET http://export.arxiv.org/api/query?id_list={id} — Atom XML, parsed with targeted
// regexes over the single-entry response (no XML dependency, per instructions).

import { notFound, upstreamError } from '../../lib/errors.js';
import { normalizeLicense } from '../../lib/license.js';
import { db } from '../../db.js';
import { createWork, addVersion, getWorkDetail, type AuthorshipInput } from '../workStore.js';
import { findExisting, backfillIds, normalizeArxivId, normalizeDoi, resolveAuthorId } from '../dedup.js';
import type { ImportResult, LicenseId } from '../../../../shared/types.js';

const USER_AGENT = 'BeyondPapers/0.1 (research-graph; mailto:admin@example.org)';

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * Our work_versions.version_number is assigned sequentially by workStore (createWork
 * always inserts as version 1; addVersion always appends MAX+1) and cannot be forced
 * to equal an arbitrary arXiv version integer without touching workStore.ts (out of
 * scope for this module). We therefore record the *actual* upstream arXiv version
 * number inside each version's change_note ("arXiv vN ...") and parse it back out here
 * to decide whether a re-import is newer than what we already have stored. Documented
 * deviation — see final summary.
 */
function extractArxivVersionFromNote(note: string | null): number | null {
  if (!note) return null;
  const m = /arXiv v(\d+)/.exec(note);
  return m ? Number(m[1]) : null;
}

function latestStoredVersion(workId: number): { version_number: number; change_note: string | null } | undefined {
  return db
    .prepare('SELECT version_number, change_note FROM work_versions WHERE work_id = ? ORDER BY version_number DESC LIMIT 1')
    .get(workId) as { version_number: number; change_note: string | null } | undefined;
}

export async function importArxiv(arxivIdRaw: string): Promise<ImportResult> {
  const requestedId = normalizeArxivId(arxivIdRaw);

  let res: Response;
  try {
    res = await fetch(`http://export.arxiv.org/api/query?id_list=${encodeURIComponent(requestedId)}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw upstreamError(`arXiv request failed: ${(err as Error).message}`);
  }
  if (!res.ok) throw upstreamError(`arXiv API returned ${res.status}`);

  const xml = await res.text();
  const entryMatch = /<entry>([\s\S]*?)<\/entry>/.exec(xml);
  if (!entryMatch) throw notFound('arXiv id not found');
  const entry = entryMatch[1];

  const idMatch = /<id>([^<]*)<\/id>/.exec(entry);
  const idText = idMatch?.[1]?.trim() ?? '';
  if (!idText || idText.includes('arxiv.org/api/errors')) {
    throw notFound('arXiv id not found');
  }

  const versionMatch = /v(\d+)\s*$/.exec(idText);
  const version = versionMatch ? Number(versionMatch[1]) : 1;
  const baseId = idText.replace(/^https?:\/\/arxiv\.org\/abs\//i, '').replace(/v\d+\s*$/i, '');

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/.exec(entry);
  const title = collapseWhitespace(titleMatch?.[1] ?? baseId);

  const summaryMatch = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(entry);
  const abstract = collapseWhitespace(summaryMatch?.[1] ?? '');

  const authorNames: string[] = [];
  const authorRegex = /<author>\s*<name>([^<]*)<\/name>/g;
  let am: RegExpExecArray | null;
  while ((am = authorRegex.exec(entry))) {
    authorNames.push(collapseWhitespace(am[1]));
  }

  // <link title="doi" href="..."/> — attribute order is not guaranteed, so scan each
  // <link> tag's attribute blob rather than anchoring title before href.
  let doi: string | null = null;
  const linkRegex = /<link\b([^>]*?)\/?>/g;
  let lm: RegExpExecArray | null;
  while ((lm = linkRegex.exec(entry))) {
    const attrs = lm[1];
    if (/title="doi"/.test(attrs)) {
      const hrefMatch = /href="([^"]*)"/.exec(attrs);
      if (hrefMatch) doi = normalizeDoi(hrefMatch[1]);
    }
  }

  const licenseMatch = /<arxiv:license[^>]*>([^<]*)<\/arxiv:license>/.exec(entry);
  // §10 table: arXiv with no explicit CC license found -> 'arxiv-default' (not normalizeLicense's
  // generic 'unknown' default, which is for genuinely-absent/unrecognized license strings elsewhere).
  const license: LicenseId = licenseMatch ? normalizeLicense(licenseMatch[1].trim()) : 'arxiv-default';

  const publishedMatch = /<published>([^<]*)<\/published>/.exec(entry);
  const publicationYear = publishedMatch ? Number(publishedMatch[1].slice(0, 4)) || null : null;

  const existing = findExisting({ arxiv_id: baseId, doi, title });
  if (existing) {
    backfillIds(existing, { doi, arxiv_id: baseId });

    const latest = latestStoredVersion(existing.id);
    const knownArxivVersion = latest ? (extractArxivVersionFromNote(latest.change_note) ?? latest.version_number) : 0;

    if (version > knownArxivVersion) {
      // §3.6 / §10: a newer arXiv version can carry a different license than earlier ones.
      addVersion(existing.id, {
        title,
        abstract,
        sections: [],
        references: [],
        license,
        change_note: `Re-imported from arXiv v${version} (license: ${license})`,
        created_by: null,
      });
    }
    return { work: getWorkDetail(existing.id)!, created: false };
  }

  const authors: AuthorshipInput[] = authorNames.map((name, i) => ({
    position: i + 1,
    author_id: resolveAuthorId({ full_name: name }),
    credit_roles: [],
  }));

  // arXiv Atom API exposes metadata only, not full text — sections always [] regardless of tier (§10).
  const work = createWork({
    kind: 'paper',
    source: 'arxiv',
    publication_status: 'preprint',
    created_by: null,
    title,
    abstract,
    sections: [],
    references: [],
    license,
    doi,
    arxiv_id: baseId,
    publication_year: publicationYear,
    authors,
    change_note: `Imported from arXiv v${version} (license: ${license})`,
  });

  return { work, created: true };
}
