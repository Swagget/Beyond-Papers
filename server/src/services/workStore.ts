// Shared work read/write helpers used by works, reviews, import routes.
// This is the ONLY module that inserts works / work_versions rows —
// it owns the licensing write-gates (§3, spec §5) and content addressing (§1.3).

import { db, runInTransaction, setCurrentVersion } from '../db.js';
import { contentHash } from '../lib/hash.js';
import { licenseToTier, canStoreFullContent, canAiTransformFullText } from '../lib/license.js';
import { licenseGate, notFound, conflict } from '../lib/errors.js';
import type {
  AuthorPreview,
  CreditRole,
  EditingMode,
  LicenseId,
  PublicationStatus,
  ResultNature,
  Section,
  Reference,
  Subunit,
  Work,
  WorkContent,
  WorkDetail,
  WorkKind,
  WorkSource,
  WorkSummary,
  WorkVersion,
} from '../../../shared/types.js';

// ---------- row mapping ----------

// works row → Work (SQLite gives back exactly the column names; no conversion needed
// beyond typing — booleans don't occur on works).
type WorkRow = Work;

export function getWork(id: number): Work | undefined {
  return db.prepare('SELECT * FROM works WHERE id = ?').get(id) as WorkRow | undefined;
}

export function getVersionRow(versionId: number): WorkVersion | undefined {
  const row = db.prepare('SELECT * FROM work_versions WHERE id = ?').get(versionId) as
    | (Omit<WorkVersion, 'content'> & { content_json: string })
    | undefined;
  if (!row) return undefined;
  const { content_json, ...rest } = row;
  return { ...rest, content: JSON.parse(content_json) as WorkContent };
}

export function authorPreviews(workId: number): AuthorPreview[] {
  const rows = db
    .prepare(
      `SELECT ah.position, ah.credit_roles, ah.user_id, ah.author_id,
              COALESCE(u.display_name, a.full_name) AS name,
              COALESCE(u.orcid, a.orcid) AS orcid
       FROM authorships ah
       LEFT JOIN users u ON u.id = ah.user_id
       LEFT JOIN authors a ON a.id = ah.author_id
       WHERE ah.work_id = ?
       ORDER BY ah.position, ah.id`,
    )
    .all(workId) as Array<{
    position: number;
    credit_roles: string;
    user_id: number | null;
    author_id: number | null;
    name: string;
    orcid: string | null;
  }>;
  return rows.map((r) => ({
    position: r.position,
    name: r.name,
    user_id: r.user_id,
    author_id: r.author_id,
    orcid: r.orcid,
    credit_roles: JSON.parse(r.credit_roles) as CreditRole[],
  }));
}

export function getSubunits(workId: number): Subunit[] {
  return db
    .prepare('SELECT * FROM subunits WHERE work_id = ? ORDER BY order_index, id')
    .all(workId) as Subunit[];
}

export function toSummary(work: Work): WorkSummary {
  return { ...work, authors: authorPreviews(work.id) };
}

export function getWorkSummary(id: number): WorkSummary | undefined {
  const work = getWork(id);
  return work ? toSummary(work) : undefined;
}

export function getWorkDetail(id: number): WorkDetail | undefined {
  const work = getWork(id);
  if (!work) return undefined;
  const current_version = work.current_version_id ? (getVersionRow(work.current_version_id) ?? null) : null;
  return {
    ...toSummary(work),
    current_version,
    subunits: work.tier === 'C' ? getSubunits(id) : [],
  };
}

// ---------- writes ----------

export interface AuthorshipInput {
  user_id?: number | null;
  author_id?: number | null;
  position: number;
  credit_roles?: CreditRole[];
}

export interface CreateWorkInput {
  kind: WorkKind;
  result_nature?: ResultNature;
  editing?: EditingMode;
  title: string;
  abstract?: string | null;
  sections?: Section[];
  references?: Reference[];
  license: LicenseId;
  source?: WorkSource;
  doi?: string | null;
  arxiv_id?: string | null;
  openalex_id?: string | null;
  url?: string | null;
  url_normalized?: string | null;
  site_name?: string | null;
  publication_status?: PublicationStatus;
  publication_year?: number | null;
  created_by?: number | null;
  change_note?: string | null;
  authors?: AuthorshipInput[];
}

/**
 * Create a work + its version 1 atomically. Enforces the licensing write-gate:
 * Tier A versions must have empty sections (422 LICENSE_GATE otherwise).
 * kind 'concept' is silently forced to editing 'communal' (spec §13.3 note).
 */
export function createWork(input: CreateWorkInput): WorkDetail {
  const tier = licenseToTier(input.license);
  const sections = input.sections ?? [];
  const references = input.references ?? [];
  if (!canStoreFullContent(tier) && sections.length > 0) {
    throw licenseGate(`License '${input.license}' is Tier A: only metadata and abstract may be stored, sections must be empty`, 422);
  }
  const editing: EditingMode = input.kind === 'concept' ? 'communal' : (input.editing ?? 'authored');

  return runInTransaction(() => {
    const workResult = db
      .prepare(
        `INSERT INTO works (kind, result_nature, editing, title, abstract, doi, arxiv_id, openalex_id,
                            url, url_normalized, site_name, source, license, tier, publication_status,
                            publication_year, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.kind,
        input.result_nature ?? 'na',
        editing,
        input.title,
        input.abstract ?? null,
        input.doi ?? null,
        input.arxiv_id ?? null,
        input.openalex_id ?? null,
        input.url ?? null,
        input.url_normalized ?? null,
        input.site_name ?? null,
        input.source ?? 'native',
        input.license,
        tier,
        input.publication_status ?? 'published',
        input.publication_year ?? null,
        input.created_by ?? null,
      );
    const workId = Number(workResult.lastInsertRowid);

    insertVersion(workId, 1, {
      title: input.title,
      abstract: input.abstract ?? '',
      sections,
      references,
    }, input.license, input.created_by ?? null, input.change_note ?? 'Initial version');

    for (const a of input.authors ?? []) {
      db.prepare(
        `INSERT INTO authorships (work_id, position, credit_roles, user_id, author_id) VALUES (?, ?, ?, ?, ?)`,
      ).run(workId, a.position, JSON.stringify(a.credit_roles ?? []), a.user_id ?? null, a.author_id ?? null);
    }

    return getWorkDetail(workId)!;
  });
}

function insertVersion(
  workId: number,
  versionNumber: number,
  content: WorkContent,
  license: LicenseId,
  createdBy: number | null,
  changeNote: string | null,
): number {
  const hash = contentHash({
    title: content.title,
    abstract: content.abstract,
    sections: content.sections,
    references: content.references,
  });
  const res = db
    .prepare(
      `INSERT INTO work_versions (work_id, version_number, content_json, content_hash, license, change_note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(workId, versionNumber, JSON.stringify(content), hash, license, changeNote, createdBy);
  const versionId = Number(res.lastInsertRowid);
  setCurrentVersion(workId, versionId);
  return versionId;
}

export interface AddVersionInput {
  title?: string;
  abstract?: string | null;
  sections?: Section[];
  references?: Reference[];
  license?: LicenseId;
  change_note?: string | null;
  created_by: number | null;
}

/**
 * Append a new immutable version (§1.3, §12.5). Unset content fields carry over
 * from the current version. Enforces the Tier-A sections gate against the NEW license.
 * Also syncs works.title/abstract/license/tier (and re-checks subunit tier-downgrade
 * conflicts — caller must check first for a clean 409; this throws as defense in depth).
 */
export function addVersion(workId: number, input: AddVersionInput): WorkDetail {
  const work = getWork(workId);
  if (!work) throw notFound('Work not found');
  const current = work.current_version_id ? getVersionRow(work.current_version_id) : undefined;
  const base: WorkContent = current?.content ?? { title: work.title, abstract: work.abstract ?? '', sections: [], references: [] };

  const content: WorkContent = {
    title: input.title ?? base.title,
    abstract: input.abstract ?? base.abstract,
    sections: input.sections ?? base.sections,
    references: input.references ?? base.references,
  };
  const license = input.license ?? (current?.license ?? work.license);
  const tier = licenseToTier(license);

  if (!canStoreFullContent(tier) && content.sections.length > 0) {
    throw licenseGate(`License '${license}' is Tier A: sections must be empty`, 422);
  }
  if (tier !== 'C' && getSubunits(workId).length > 0) {
    // 409 on both the PATCH and revert paths (spec §5 enforcement list).
    throw conflict('Cannot downgrade below tier C while subunits exist');
  }

  return runInTransaction(() => {
    const nextNumber =
      (db.prepare('SELECT MAX(version_number) AS m FROM work_versions WHERE work_id = ?').get(workId) as { m: number | null })
        .m ?? 0;
    insertVersion(workId, nextNumber + 1, content, license, input.created_by, input.change_note ?? null);
    db.prepare(
      `UPDATE works SET title = ?, abstract = ?, license = ?, tier = ? WHERE id = ?`,
    ).run(content.title, content.abstract, license, tier, workId);
    if (!canAiTransformFullText(tier)) {
      // License no longer permits full-text AI transformation: retire existing AI
      // outputs, which may embed full-section text generated under the old tier.
      // They can be regenerated at abstract scope on demand (§3.2, invariant §15.1).
      db.prepare('UPDATE ai_outputs SET is_current = 0 WHERE work_id = ? AND is_current = 1').run(workId);
    }
    return getWorkDetail(workId)!;
  });
}

/** §12.3 edit permission: authored → only linked authors/creator; communal → any authenticated user. */
export function canEdit(work: Work, userId: number): boolean {
  if (work.editing === 'communal') return true;
  if (work.created_by === userId) return true;
  const row = db
    .prepare('SELECT 1 FROM authorships WHERE work_id = ? AND user_id = ?')
    .get(work.id, userId);
  return row !== undefined;
}
