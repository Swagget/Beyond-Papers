// Mounted at /api (see index.ts): /works/:id/export/latex, /bibtex, /json, /versions/:hash — spec §9, §13.10.
import { Router } from 'express';
import { db } from '../db.js';
import { notFound, validationError, wrapAsync } from '../lib/errors.js';
import { getWorkDetail } from '../services/workStore.js';
import { renderBibtex, renderLatex, splitName } from '../services/latex.js';
import type { LicenseId, WorkContent, WorkKind, WorkVersion } from '../../../shared/types.js';

const router = Router();

/** §9 license-URL mapping used only for the Crossref-like JSON export. */
function mapLicenseUrl(license: LicenseId): string | null {
  switch (license) {
    case 'cc-by':
      return 'https://creativecommons.org/licenses/by/4.0/';
    case 'cc-by-sa':
    case 'platform-cc-by-sa':
      return 'https://creativecommons.org/licenses/by-sa/4.0/';
    case 'cc0':
      return 'https://creativecommons.org/publicdomain/zero/1.0/';
    case 'public-domain':
      return 'https://creativecommons.org/publicdomain/mark/1.0/';
    case 'cc-by-nd':
      return 'https://creativecommons.org/licenses/by-nd/4.0/';
    case 'cc-by-nc':
      return 'https://creativecommons.org/licenses/by-nc/4.0/';
    case 'cc-by-nc-sa':
      return 'https://creativecommons.org/licenses/by-nc-sa/4.0/';
    case 'cc-by-nc-nd':
      return 'https://creativecommons.org/licenses/by-nc-nd/4.0/';
    case 'closed':
    case 'unknown':
    case 'arxiv-default':
    default:
      return null;
  }
}

function mapKindToCrossrefType(kind: WorkKind): string {
  switch (kind) {
    case 'paper':
      return 'journal-article';
    case 'review':
      return 'peer-review';
    case 'replication':
      return 'journal-article';
    case 'dataset':
      return 'dataset';
    case 'code':
      return 'other';
    case 'concept':
      return 'other';
    default:
      return 'other';
  }
}

function parseWorkId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw validationError('Invalid work id');
  return id;
}

router.get(
  '/works/:id/export/latex',
  wrapAsync(async (req, res) => {
    const id = parseWorkId(req.params.id);
    const work = getWorkDetail(id);
    if (!work) throw notFound('Work not found');

    const body = renderLatex(work);
    const versionNumber = work.current_version?.version_number ?? 0;
    res.setHeader('Content-Type', 'application/x-latex');
    res.setHeader('Content-Disposition', `attachment; filename="work-${id}-v${versionNumber}.tex"`);
    res.send(body);
  }),
);

router.get(
  '/works/:id/export/bibtex',
  wrapAsync(async (req, res) => {
    const id = parseWorkId(req.params.id);
    const work = getWorkDetail(id);
    if (!work) throw notFound('Work not found');

    const body = renderBibtex(work);
    res.setHeader('Content-Type', 'application/x-bibtex');
    res.setHeader('Content-Disposition', `attachment; filename="work-${id}.bib"`);
    res.send(body);
  }),
);

router.get(
  '/works/:id/export/json',
  wrapAsync(async (req, res) => {
    const id = parseWorkId(req.params.id);
    const work = getWorkDetail(id);
    if (!work) throw notFound('Work not found');

    const content: WorkContent = work.current_version?.content ?? {
      title: work.title,
      abstract: work.abstract ?? '',
      sections: [],
      references: [],
    };

    const year = work.publication_year ?? new Date(work.created_at).getUTCFullYear();

    const author = work.authors
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((a) => {
        const { given, family } = splitName(a.name);
        return { given, family, ORCID: a.orcid };
      });

    const licenseUrl = mapLicenseUrl(work.license);

    const json = {
      DOI: work.doi,
      title: content.title,
      abstract: work.abstract,
      author,
      type: mapKindToCrossrefType(work.kind),
      published: { 'date-parts': [[year]] },
      license: licenseUrl ? [{ URL: licenseUrl, 'content-version': 'vor', 'delay-in-days': 0 }] : [],
      reference: content.references.map((r) => ({
        key: r.label,
        unstructured: r.raw,
        ...(r.doi ? { doi: r.doi } : {}),
      })),
      'beyond-papers': {
        id: work.id,
        tier: work.tier,
        kind: work.kind,
        result_nature: work.result_nature,
        license: work.license,
        current_version_hash: work.current_version?.content_hash ?? null,
      },
    };

    res.json(json);
  }),
);

interface VersionHashRow {
  id: number;
  work_id: number;
  version_number: number;
  content_json: string;
  content_hash: string;
  license: string;
  change_note: string | null;
  created_by: number | null;
  created_at: string;
  work_title: string;
  work_tier: string;
  work_license: string;
}

router.get(
  '/versions/:hash',
  wrapAsync(async (req, res) => {
    const hash = req.params.hash;
    if (!/^[0-9a-f]{64}$/i.test(hash)) {
      throw validationError('hash must be a 64-character hex string');
    }

    const rows = db
      .prepare(
        `SELECT wv.id, wv.work_id, wv.version_number, wv.content_json, wv.content_hash, wv.license,
                wv.change_note, wv.created_by, wv.created_at,
                w.title AS work_title, w.tier AS work_tier, w.license AS work_license
         FROM work_versions wv
         JOIN works w ON w.id = wv.work_id
         WHERE wv.content_hash = ?
         ORDER BY wv.created_at DESC`,
      )
      .all(hash) as VersionHashRow[];

    if (rows.length === 0) throw notFound('No version matches this content hash');

    const matches = rows.map((r) => {
      const version: WorkVersion = {
        id: r.id,
        work_id: r.work_id,
        version_number: r.version_number,
        content: JSON.parse(r.content_json) as WorkContent,
        content_hash: r.content_hash,
        license: r.license as LicenseId,
        change_note: r.change_note,
        created_by: r.created_by,
        created_at: r.created_at,
      };
      return {
        version,
        work: { id: r.work_id, title: r.work_title, tier: r.work_tier, license: r.work_license },
      };
    });

    res.json({ matches });
  }),
);

export default router;
