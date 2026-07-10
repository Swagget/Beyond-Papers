import { Router, type Request } from 'express';
import { db } from '../db.js';
import { wrapAsync, validationError, notFound, forbidden, conflict } from '../lib/errors.js';
import { requireAuth, ORCID_RE } from '../lib/auth.js';
import { toSummary } from '../services/workStore.js';
import type { User, Work, WorkSummary, Paginated } from '../../../shared/types.js';

// Mounted at /api/users (spec §13.2): /:id, /:id/works, /:id/reviews.
const router = Router();

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  is_pseudonym: number;
  orcid: string | null;
  bio: string | null;
  is_admin: number;
  created_at: string;
}

const USER_COLUMNS = 'id, username, display_name, is_pseudonym, orcid, bio, is_admin, created_at';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    is_pseudonym: !!row.is_pseudonym,
    orcid: row.orcid,
    bio: row.bio,
    is_admin: !!row.is_admin,
    created_at: row.created_at,
  };
}

function parseId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw notFound('User not found');
  return id;
}

function parsePagination(req: Request): { limit: number; offset: number } {
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? ''), 10) || 20));
  const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? ''), 10) || 0);
  return { limit, offset };
}

function getUserRow(id: number): UserRow | undefined {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

router.get(
  '/:id',
  wrapAsync(async (req, res) => {
    const id = parseId(req);
    const row = getUserRow(id);
    if (!row) throw notFound('User not found');
    res.json({ user: toUser(row) });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = parseId(req);
    if (!req.user || req.user.id !== id) throw forbidden('You may only edit your own profile');

    const existing = getUserRow(id);
    if (!existing) throw notFound('User not found');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const { display_name, bio, orcid, is_pseudonym } = body;

    if (display_name !== undefined && (typeof display_name !== 'string' || display_name.trim().length === 0)) {
      throw validationError('display_name must be a non-empty string');
    }
    if (bio !== undefined && bio !== null && typeof bio !== 'string') {
      throw validationError('bio must be a string');
    }
    if (orcid !== undefined && orcid !== null && (typeof orcid !== 'string' || !ORCID_RE.test(orcid))) {
      throw validationError('orcid must match ####-####-####-###[X]');
    }
    if (is_pseudonym !== undefined && typeof is_pseudonym !== 'boolean') {
      throw validationError('is_pseudonym must be a boolean');
    }

    if (orcid) {
      const taken = db.prepare('SELECT id FROM users WHERE orcid = ? AND id != ?').get(orcid as string, id);
      if (taken) throw conflict('ORCID already linked to another user');
    }

    const nextDisplayName = display_name !== undefined ? (display_name as string) : existing.display_name;
    const nextBio = bio !== undefined ? (bio as string | null) : existing.bio;
    const nextOrcid = orcid !== undefined ? (orcid as string | null) : existing.orcid;
    const nextIsPseudonym = is_pseudonym !== undefined ? (is_pseudonym ? 1 : 0) : existing.is_pseudonym;

    try {
      db.prepare(`UPDATE users SET display_name = ?, bio = ?, orcid = ?, is_pseudonym = ? WHERE id = ?`).run(
        nextDisplayName,
        nextBio,
        nextOrcid,
        nextIsPseudonym,
        id,
      );
    } catch {
      // Race-safety net: UNIQUE(orcid) constraint hit between the check above and the update.
      throw conflict('ORCID already linked to another user');
    }

    const row = getUserRow(id)!;
    res.json({ user: toUser(row) });
  }),
);

router.get(
  '/:id/works',
  wrapAsync(async (req, res) => {
    const id = parseId(req);
    if (!getUserRow(id)) throw notFound('User not found');
    const { limit, offset } = parsePagination(req);

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM works w
         WHERE w.kind != 'review'
           AND (w.created_by = ? OR EXISTS (SELECT 1 FROM authorships ah WHERE ah.work_id = w.id AND ah.user_id = ?))`,
      )
      .get(id, id) as { c: number };

    const rows = db
      .prepare(
        `SELECT w.* FROM works w
         WHERE w.kind != 'review'
           AND (w.created_by = ? OR EXISTS (SELECT 1 FROM authorships ah WHERE ah.work_id = w.id AND ah.user_id = ?))
         ORDER BY w.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(id, id, limit, offset) as Work[];

    const body: Paginated<WorkSummary> = { items: rows.map(toSummary), total: totalRow.c, limit, offset };
    res.json(body);
  }),
);

router.get(
  '/:id/reviews',
  wrapAsync(async (req, res) => {
    const id = parseId(req);
    if (!getUserRow(id)) throw notFound('User not found');
    const { limit, offset } = parsePagination(req);

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM works w
         WHERE w.kind = 'review'
           AND (w.created_by = ? OR EXISTS (SELECT 1 FROM authorships ah WHERE ah.work_id = w.id AND ah.user_id = ?))`,
      )
      .get(id, id) as { c: number };

    const rows = db
      .prepare(
        `SELECT w.* FROM works w
         WHERE w.kind = 'review'
           AND (w.created_by = ? OR EXISTS (SELECT 1 FROM authorships ah WHERE ah.work_id = w.id AND ah.user_id = ?))
         ORDER BY w.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(id, id, limit, offset) as Work[];

    const body: Paginated<WorkSummary> = { items: rows.map(toSummary), total: totalRow.c, limit, offset };
    res.json(body);
  }),
);

export default router;
