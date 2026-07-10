import { Router } from 'express';
import { db } from '../db.js';
import { wrapAsync, validationError, forbidden, licenseGate, notFound, conflict } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { licenseToTier, canCreateSubunits, isLicense } from '../lib/license.js';
import { contentHash } from '../lib/hash.js';
import {
  getWork,
  getWorkDetail,
  getVersionRow,
  getSubunits,
  canEdit,
  createWork,
  addVersion,
  toSummary,
} from '../services/workStore.js';
import type { AuthorshipInput } from '../services/workStore.js';
import {
  CREDIT_ROLES,
  SUBUNIT_TYPES,
} from '../../../shared/types.js';
import type {
  Authorship,
  CreditRole,
  LicenseId,
  Reference,
  ResultNature,
  EditingMode,
  Section,
  Subunit,
  Work,
  WorkContent,
  WorkKind,
  WorkSummary,
  WorkVersion,
} from '../../../shared/types.js';

const router = Router();

const WORK_KINDS: WorkKind[] = ['paper', 'review', 'replication', 'concept', 'dataset', 'code'];
const RESULT_NATURES: ResultNature[] = ['positive', 'negative', 'null', 'inconclusive', 'na'];
const EDITING_MODES: EditingMode[] = ['authored', 'communal'];

// ---------- small validation helpers ----------

function parseWorkId(param: string): number {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) throw notFound('Work not found');
  return id;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function isValidSection(s: unknown): s is Section {
  if (typeof s !== 'object' || s === null) return false;
  const o = s as Record<string, unknown>;
  return typeof o.heading === 'string' && typeof o.body === 'string' && typeof o.order === 'number';
}

function validateSections(sections: unknown): Section[] {
  if (!Array.isArray(sections) || !sections.every(isValidSection)) {
    throw validationError('sections must be an array of {heading, body, order}');
  }
  return sections;
}

function isValidReference(r: unknown): r is Reference {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  if (typeof o.label !== 'string' || typeof o.raw !== 'string') return false;
  if (o.work_id !== undefined && typeof o.work_id !== 'number') return false;
  if (o.doi !== undefined && typeof o.doi !== 'string') return false;
  if (o.url !== undefined && typeof o.url !== 'string') return false;
  return true;
}

function validateReferences(references: unknown): Reference[] {
  if (!Array.isArray(references) || !references.every(isValidReference)) {
    throw validationError('references must be an array of {label, raw, work_id?, doi?, url?}');
  }
  return references;
}

function isCreditRoleArray(value: unknown): value is CreditRole[] {
  return Array.isArray(value) && value.every((r) => (CREDIT_ROLES as string[]).includes(r as string));
}

function validateAuthorsInput(authors: unknown): AuthorshipInput[] {
  if (!Array.isArray(authors)) throw validationError('authors must be an array');
  return authors.map((a) => {
    if (typeof a !== 'object' || a === null) throw validationError('invalid authorship entry');
    const o = a as Record<string, unknown>;
    const hasUser = o.user_id !== undefined && o.user_id !== null;
    const hasAuthor = o.author_id !== undefined && o.author_id !== null;
    if (hasUser === hasAuthor) {
      throw validationError('each authorship needs exactly one of user_id or author_id');
    }
    if (typeof o.position !== 'number' || !Number.isInteger(o.position)) {
      throw validationError('authorship position must be an integer');
    }
    const creditRoles = o.credit_roles ?? [];
    if (!isCreditRoleArray(creditRoles)) {
      throw validationError('credit_roles must be a subset of the CRediT taxonomy');
    }
    return {
      user_id: hasUser ? Number(o.user_id) : null,
      author_id: hasAuthor ? Number(o.author_id) : null,
      position: o.position,
      credit_roles: creditRoles,
    };
  });
}

// ---------- POST /works ----------

router.post(
  '/works',
  requireAuth,
  wrapAsync(async (req, res) => {
    const body = req.body ?? {};

    if (!WORK_KINDS.includes(body.kind)) {
      throw validationError(`kind must be one of ${WORK_KINDS.join(', ')}`);
    }
    if (!isLicense(body.license)) {
      throw validationError('license must be a valid LicenseId');
    }
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      throw validationError('title is required');
    }
    if (body.result_nature !== undefined && !RESULT_NATURES.includes(body.result_nature)) {
      throw validationError(`result_nature must be one of ${RESULT_NATURES.join(', ')}`);
    }
    if (body.editing !== undefined && !EDITING_MODES.includes(body.editing)) {
      throw validationError(`editing must be one of ${EDITING_MODES.join(', ')}`);
    }
    if (body.abstract !== undefined && body.abstract !== null && typeof body.abstract !== 'string') {
      throw validationError('abstract must be a string or null');
    }

    const sections = body.sections !== undefined ? validateSections(body.sections) : [];
    const references = body.references !== undefined ? validateReferences(body.references) : [];
    const authors: AuthorshipInput[] =
      body.authors !== undefined
        ? validateAuthorsInput(body.authors)
        : [{ user_id: req.user!.id, author_id: null, position: 1, credit_roles: [] }];

    const work = createWork({
      kind: body.kind as WorkKind,
      result_nature: body.result_nature as ResultNature | undefined,
      editing: body.editing as EditingMode | undefined,
      title: body.title,
      abstract: body.abstract ?? null,
      sections,
      references,
      license: body.license as LicenseId,
      source: 'native',
      created_by: req.user!.id,
      authors,
    });

    res.status(201).json({ work });
  }),
);

// ---------- GET /works ----------

router.get(
  '/works',
  wrapAsync(async (req, res) => {
    const { kind, result_nature, tier, source, editing, q, sort } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (typeof kind === 'string') {
      conditions.push('works.kind = ?');
      params.push(kind);
    }
    if (typeof result_nature === 'string') {
      conditions.push('works.result_nature = ?');
      params.push(result_nature);
    }
    if (typeof tier === 'string') {
      conditions.push('works.tier = ?');
      params.push(tier);
    }
    if (typeof source === 'string') {
      conditions.push('works.source = ?');
      params.push(source);
    }
    if (typeof editing === 'string') {
      conditions.push('works.editing = ?');
      params.push(editing);
    }

    let fromClause = 'works';
    if (typeof q === 'string' && q.trim().length > 0) {
      // Escape each whitespace-separated term as an FTS5 phrase (double the internal
      // quote char to escape it) so user input can never break out into FTS syntax.
      const terms = q
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0)
        .map((t) => `"${t.replace(/"/g, '""')}"`);
      if (terms.length > 0) {
        fromClause = 'works JOIN works_fts ON works_fts.rowid = works.id';
        conditions.push('works_fts MATCH ?');
        params.push(terms.join(' '));
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = sort === 'title' ? 'works.title COLLATE NOCASE ASC' : 'works.created_at DESC';

    const limit = clampInt(req.query.limit, 20, 1, 100);
    const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    const total = (
      db.prepare(`SELECT COUNT(*) AS count FROM ${fromClause} ${whereClause}`).get(...params) as { count: number }
    ).count;

    const rows = db
      .prepare(`SELECT works.* FROM ${fromClause} ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Work[];

    const items: WorkSummary[] = rows.map(toSummary);

    res.json({ items, total, limit, offset });
  }),
);

// ---------- GET /works/:id ----------

router.get(
  '/works/:id',
  wrapAsync(async (req, res) => {
    const id = parseWorkId(req.params.id);
    const work = getWorkDetail(id);
    if (!work) throw notFound('Work not found');
    res.json({ work });
  }),
);

// ---------- PATCH /works/:id ----------

router.patch(
  '/works/:id',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = parseWorkId(req.params.id);
    const work = getWork(id);
    if (!work) throw notFound('Work not found');
    if (!canEdit(work, req.user!.id)) throw forbidden('authored work: only authors may edit');

    const body = req.body ?? {};

    if (typeof body.change_note !== 'string' || body.change_note.trim().length === 0) {
      throw validationError('change_note is required');
    }
    if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim().length === 0)) {
      throw validationError('title must be a non-empty string');
    }
    if (body.abstract !== undefined && body.abstract !== null && typeof body.abstract !== 'string') {
      throw validationError('abstract must be a string or null');
    }
    if (body.license !== undefined && !isLicense(body.license)) {
      throw validationError('license must be a valid LicenseId');
    }

    const sections = body.sections !== undefined ? validateSections(body.sections) : undefined;
    const references = body.references !== undefined ? validateReferences(body.references) : undefined;

    // Check the tier-downgrade-with-subunits conflict BEFORE calling addVersion so the
    // client gets a clean 409, not workStore's internal licenseGate defense-in-depth.
    const effectiveLicense: LicenseId = (body.license as LicenseId | undefined) ?? work.license;
    const effectiveTier = licenseToTier(effectiveLicense);
    if (effectiveTier !== 'C' && getSubunits(id).length > 0) {
      throw conflict('cannot downgrade below tier C while subunits exist');
    }

    const updated = addVersion(id, {
      title: body.title,
      abstract: body.abstract,
      sections,
      references,
      license: body.license as LicenseId | undefined,
      change_note: body.change_note,
      created_by: req.user!.id,
    });

    res.json({ work: updated });
  }),
);

// ---------- POST /works/:id/revert ----------

router.post(
  '/works/:id/revert',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = parseWorkId(req.params.id);
    const work = getWork(id);
    if (!work) throw notFound('Work not found');
    if (!canEdit(work, req.user!.id)) throw forbidden('authored work: only authors may edit');

    const body = req.body ?? {};
    const versionId = Number(body.version_id);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      throw validationError('version_id is required');
    }

    const version = getVersionRow(versionId);
    if (!version || version.work_id !== id) throw notFound('Version not found for this work');

    const changeNote =
      typeof body.change_note === 'string' && body.change_note.trim().length > 0
        ? body.change_note
        : `Revert to version ${version.version_number}`;

    const updated = addVersion(id, {
      title: version.content.title,
      abstract: version.content.abstract,
      sections: version.content.sections,
      references: version.content.references,
      license: version.license,
      change_note: changeNote,
      created_by: req.user!.id,
    });

    res.status(201).json({ work: updated });
  }),
);

// ---------- GET /works/:id/versions ----------

router.get(
  '/works/:id/versions',
  wrapAsync(async (req, res) => {
    const id = parseWorkId(req.params.id);
    const work = getWork(id);
    if (!work) throw notFound('Work not found');

    const limit = clampInt(req.query.limit, 20, 1, 100);
    const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    const total = (
      db.prepare('SELECT COUNT(*) AS count FROM work_versions WHERE work_id = ?').get(id) as { count: number }
    ).count;

    const rows = db
      .prepare('SELECT * FROM work_versions WHERE work_id = ? ORDER BY version_number DESC LIMIT ? OFFSET ?')
      .all(id, limit, offset) as Array<Omit<WorkVersion, 'content'> & { content_json: string }>;

    const items: WorkVersion[] = rows.map(({ content_json, ...rest }) => ({
      ...rest,
      content: JSON.parse(content_json) as WorkContent,
    }));

    res.json({ items, total, limit, offset });
  }),
);

// ---------- GET /works/:id/subunits ----------

router.get(
  '/works/:id/subunits',
  wrapAsync(async (req, res) => {
    const id = parseWorkId(req.params.id);
    const work = getWork(id);
    if (!work) throw notFound('Work not found');
    const items = work.tier === 'C' ? getSubunits(id) : [];
    res.json({ items });
  }),
);

// ---------- POST /works/:id/subunits ----------

router.post(
  '/works/:id/subunits',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = parseWorkId(req.params.id);
    const work = getWork(id);
    if (!work) throw notFound('Work not found');
    if (!canEdit(work, req.user!.id)) throw forbidden('authored work: only authors may edit');
    if (!canCreateSubunits(work.tier)) throw licenseGate('Subunits require a Tier C license');

    const body = req.body ?? {};
    if (!SUBUNIT_TYPES.includes(body.type)) {
      throw validationError(`type must be one of ${SUBUNIT_TYPES.join(', ')}`);
    }
    if (typeof body.content !== 'string' || body.content.trim().length === 0) {
      throw validationError('content is required');
    }
    if (body.title !== undefined && body.title !== null && typeof body.title !== 'string') {
      throw validationError('title must be a string');
    }
    const orderIndex = body.order_index !== undefined ? Number(body.order_index) : 0;
    if (!Number.isInteger(orderIndex)) {
      throw validationError('order_index must be an integer');
    }
    if (!work.current_version_id) {
      throw validationError('Work has no version to attach subunits to');
    }

    const title: string | null = body.title ?? null;
    const hash = contentHash({ type: body.type, title, content: body.content });

    const result = db
      .prepare(
        `INSERT INTO subunits (work_id, version_id, type, title, content, content_hash, order_index, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, work.current_version_id, body.type, title, body.content, hash, orderIndex, req.user!.id);

    const subunit = db
      .prepare('SELECT * FROM subunits WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as Subunit;

    res.status(201).json({ subunit });
  }),
);

// ---------- GET /works/:id/authors ----------

router.get(
  '/works/:id/authors',
  wrapAsync(async (req, res) => {
    const id = parseWorkId(req.params.id);
    const work = getWork(id);
    if (!work) throw notFound('Work not found');

    const rows = db
      .prepare('SELECT * FROM authorships WHERE work_id = ? ORDER BY position, id')
      .all(id) as Array<Omit<Authorship, 'credit_roles'> & { credit_roles: string }>;

    const items: Authorship[] = rows.map((r) => ({
      ...r,
      credit_roles: JSON.parse(r.credit_roles) as CreditRole[],
    }));

    res.json({ items });
  }),
);

// ---------- POST /works/:id/authors ----------

router.post(
  '/works/:id/authors',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = parseWorkId(req.params.id);
    const work = getWork(id);
    if (!work) throw notFound('Work not found');
    if (!canEdit(work, req.user!.id)) throw forbidden('authored work: only authors may edit');

    const body = req.body ?? {};
    const hasUser = body.user_id !== undefined && body.user_id !== null;
    const hasAuthor = body.author_id !== undefined && body.author_id !== null;
    if (hasUser === hasAuthor) {
      throw validationError('exactly one of user_id or author_id is required');
    }

    if (hasUser) {
      const u = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(body.user_id));
      if (!u) throw notFound('User not found');
    } else {
      const a = db.prepare('SELECT id FROM authors WHERE id = ?').get(Number(body.author_id));
      if (!a) throw notFound('Author not found');
    }

    if (typeof body.position !== 'number' || !Number.isInteger(body.position)) {
      throw validationError('position must be an integer');
    }
    const creditRoles = body.credit_roles ?? [];
    if (!isCreditRoleArray(creditRoles)) {
      throw validationError('credit_roles must be a subset of the CRediT taxonomy');
    }

    const result = db
      .prepare('INSERT INTO authorships (work_id, position, credit_roles, user_id, author_id) VALUES (?, ?, ?, ?, ?)')
      .run(id, body.position, JSON.stringify(creditRoles), hasUser ? Number(body.user_id) : null, hasAuthor ? Number(body.author_id) : null);

    const row = db
      .prepare('SELECT * FROM authorships WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as Omit<Authorship, 'credit_roles'> & { credit_roles: string };

    const authorship: Authorship = { ...row, credit_roles: JSON.parse(row.credit_roles) as CreditRole[] };

    res.status(201).json({ authorship });
  }),
);

export default router;
