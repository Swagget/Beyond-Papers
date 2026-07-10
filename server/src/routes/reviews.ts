import { Router } from 'express';
import { db, nowIso, runInTransaction } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { forbidden, notFound, validationError, wrapAsync } from '../lib/errors.js';
import { isLicense } from '../lib/license.js';
import { createWork, getWork, toSummary } from '../services/workStore.js';
import type {
  Comment,
  Edge,
  EdgeDetail,
  LicenseId,
  Paginated,
  Reference,
  ResultNature,
  Section,
  WorkDetail,
  WorkSummary,
} from '../../../shared/types.js';

// Mounted at /api (see index.ts): /works/:id/reviews, /works/:id/comments, /comments/:id.
const router = Router();

const RESULT_NATURES: ResultNature[] = ['positive', 'negative', 'null', 'inconclusive', 'na'];

function parsePagination(query: Record<string, unknown>): { limit: number; offset: number } {
  const rawLimit = Number(query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), 100) : 20;
  const rawOffset = Number(query.offset);
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.trunc(rawOffset) : 0;
  return { limit, offset };
}

// ---------- edges (local, minimal — full edge lifecycle lives in routes/edges.ts) ----------

type EdgeRow = Edge;

/** Builds the EdgeDetail response shape for a freshly-created/queried edge row. */
function loadEdgeDetail(edgeId: number, userId?: number | null): EdgeDetail {
  const row = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId) as EdgeRow;
  const agg = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0) AS up,
              COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0) AS down
       FROM edge_votes WHERE edge_id = ?`,
    )
    .get(edgeId) as { up: number; down: number };
  let myVote: -1 | 0 | 1 = 0;
  if (userId != null) {
    const mv = db.prepare('SELECT vote FROM edge_votes WHERE edge_id = ? AND user_id = ?').get(edgeId, userId) as
      | { vote: 1 | -1 }
      | undefined;
    if (mv) myVote = mv.vote;
  }
  return { ...row, votes: { up: agg.up, down: agg.down, my_vote: myVote } };
}

/** Inserts a confirmed, human-asserted 'reviews' edge: source = review work, target = reviewed work. */
function insertReviewEdge(reviewWorkId: number, targetWorkId: number, userId: number): EdgeDetail {
  const now = nowIso();
  const result = db
    .prepare(
      `INSERT INTO edges (source_work_id, target_work_id, type, origin, asserted_by_user, status, confirmed_by, confirmed_at)
       VALUES (?, ?, 'reviews', 'human', ?, 'confirmed', ?, ?)`,
    )
    .run(reviewWorkId, targetWorkId, userId, userId, now);
  return loadEdgeDetail(Number(result.lastInsertRowid), userId);
}

// ---------- comments (local row mapping) ----------

interface CommentRow {
  id: number;
  work_id: number;
  subunit_id: number | null;
  parent_id: number | null;
  author_user_id: number;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  author_name: string;
}

function mapComment(row: CommentRow): Comment {
  return {
    id: row.id,
    work_id: row.work_id,
    subunit_id: row.subunit_id,
    parent_id: row.parent_id,
    author_user_id: row.author_user_id,
    author_name: row.author_name,
    // Belt-and-braces: the DB row's body is already overwritten to '[deleted]' by DELETE below,
    // but re-map here too in case deleted_at is ever set without the body rewrite.
    body: row.deleted_at ? '[deleted]' : row.body,
    created_at: row.created_at,
    edited_at: row.edited_at,
    deleted_at: row.deleted_at,
  };
}

function getCommentById(id: number): Comment | undefined {
  const row = db
    .prepare(
      `SELECT c.*, u.display_name AS author_name
       FROM comments c JOIN users u ON u.id = c.author_user_id
       WHERE c.id = ?`,
    )
    .get(id) as CommentRow | undefined;
  return row ? mapComment(row) : undefined;
}

// ============================================================
// POST /works/:id/reviews — create a first-class review work + confirmed 'reviews' edge
// ============================================================

router.post(
  '/works/:id/reviews',
  requireAuth,
  wrapAsync(async (req, res) => {
    const targetId = Number(req.params.id);
    const target = getWork(targetId);
    if (!target) throw notFound('Target work not found');

    const body = (req.body ?? {}) as {
      title?: unknown;
      abstract?: unknown;
      sections?: unknown;
      references?: unknown;
      license?: unknown;
      result_nature?: unknown;
    };

    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      throw validationError('title is required');
    }
    if (typeof body.abstract !== 'string') {
      throw validationError('abstract is required');
    }
    if (body.sections !== undefined && !Array.isArray(body.sections)) {
      throw validationError('sections must be an array');
    }
    if (body.references !== undefined && !Array.isArray(body.references)) {
      throw validationError('references must be an array');
    }
    let license: LicenseId = 'platform-cc-by-sa';
    if (body.license !== undefined) {
      if (typeof body.license !== 'string' || !isLicense(body.license)) {
        throw validationError('Invalid license');
      }
      license = body.license;
    }
    let resultNature: ResultNature | undefined;
    if (body.result_nature !== undefined) {
      if (typeof body.result_nature !== 'string' || !RESULT_NATURES.includes(body.result_nature as ResultNature)) {
        throw validationError('Invalid result_nature');
      }
      resultNature = body.result_nature as ResultNature;
    }

    const userId = req.user!.id;
    const sections = (body.sections as Section[] | undefined) ?? [];
    const references = (body.references as Reference[] | undefined) ?? [];

    const { review, edge } = runInTransaction((): { review: WorkDetail; edge: EdgeDetail } => {
      const review = createWork({
        kind: 'review',
        editing: 'authored',
        title: body.title as string,
        abstract: body.abstract as string,
        sections,
        references,
        license,
        result_nature: resultNature,
        created_by: userId,
        authors: [{ user_id: userId, position: 1, credit_roles: [] }],
      });
      const edge = insertReviewEdge(review.id, targetId, userId);
      return { review, edge };
    });

    res.status(201).json({ review, edge });
  }),
);

// ============================================================
// GET /works/:id/reviews — works linked via confirmed 'reviews' edges targeting :id
// ============================================================

router.get(
  '/works/:id/reviews',
  wrapAsync(async (req, res) => {
    const targetId = Number(req.params.id);
    const target = getWork(targetId);
    if (!target) throw notFound('Work not found');

    const { limit, offset } = parsePagination(req.query as Record<string, unknown>);

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM edges e
         WHERE e.target_work_id = ? AND e.type = 'reviews' AND e.status = 'confirmed'`,
      )
      .get(targetId) as { c: number };

    const rows = db
      .prepare(
        `SELECT w.id FROM edges e
         JOIN works w ON w.id = e.source_work_id
         WHERE e.target_work_id = ? AND e.type = 'reviews' AND e.status = 'confirmed'
         ORDER BY w.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(targetId, limit, offset) as { id: number }[];

    const items: WorkSummary[] = rows.map((r) => toSummary(getWork(r.id)!));
    const response: Paginated<WorkSummary> = { items, total: totalRow.c, limit, offset };
    res.json(response);
  }),
);

// ============================================================
// GET /works/:id/comments — threaded (client nests by parent_id)
// ============================================================

router.get(
  '/works/:id/comments',
  wrapAsync(async (req, res) => {
    const workId = Number(req.params.id);
    const work = getWork(workId);
    if (!work) throw notFound('Work not found');

    const subunitIdRaw = req.query.subunit_id;
    let rows: CommentRow[];
    if (subunitIdRaw !== undefined) {
      const subunitId = Number(subunitIdRaw);
      rows = db
        .prepare(
          `SELECT c.*, u.display_name AS author_name
           FROM comments c JOIN users u ON u.id = c.author_user_id
           WHERE c.work_id = ? AND c.subunit_id = ?
           ORDER BY c.created_at ASC`,
        )
        .all(workId, subunitId) as CommentRow[];
    } else {
      rows = db
        .prepare(
          `SELECT c.*, u.display_name AS author_name
           FROM comments c JOIN users u ON u.id = c.author_user_id
           WHERE c.work_id = ?
           ORDER BY c.created_at ASC`,
        )
        .all(workId) as CommentRow[];
    }

    res.json({ items: rows.map(mapComment) });
  }),
);

// ============================================================
// POST /works/:id/comments
// ============================================================

router.post(
  '/works/:id/comments',
  requireAuth,
  wrapAsync(async (req, res) => {
    const workId = Number(req.params.id);
    const work = getWork(workId);
    if (!work) throw notFound('Work not found');

    const body = (req.body ?? {}) as { body?: unknown; subunit_id?: unknown; parent_id?: unknown };
    if (typeof body.body !== 'string' || body.body.trim().length === 0) {
      throw validationError('body is required');
    }

    let subunitId: number | null = null;
    if (body.subunit_id !== undefined && body.subunit_id !== null) {
      subunitId = Number(body.subunit_id);
      const subunit = db.prepare('SELECT 1 FROM subunits WHERE id = ? AND work_id = ?').get(subunitId, workId);
      if (!subunit) throw notFound('Subunit not found on this work');
    }

    let parentId: number | null = null;
    if (body.parent_id !== undefined && body.parent_id !== null) {
      parentId = Number(body.parent_id);
      const parent = db.prepare('SELECT 1 FROM comments WHERE id = ? AND work_id = ?').get(parentId, workId);
      if (!parent) throw notFound('Parent comment not found on this work');
    }

    const result = db
      .prepare(
        `INSERT INTO comments (work_id, subunit_id, parent_id, author_user_id, body) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(workId, subunitId, parentId, req.user!.id, body.body);

    const comment = getCommentById(Number(result.lastInsertRowid))!;
    res.status(201).json({ comment });
  }),
);

// ============================================================
// PATCH /comments/:id — author-only
// ============================================================

router.patch(
  '/comments/:id',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as
      | { id: number; author_user_id: number }
      | undefined;
    if (!row) throw notFound('Comment not found');
    if (row.author_user_id !== req.user!.id) throw forbidden("Only the comment's author may edit it");

    const body = (req.body ?? {}) as { body?: unknown };
    if (typeof body.body !== 'string' || body.body.trim().length === 0) {
      throw validationError('body is required');
    }

    db.prepare(`UPDATE comments SET body = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(
      body.body,
      id,
    );

    const comment = getCommentById(id)!;
    res.json({ comment });
  }),
);

// ============================================================
// DELETE /comments/:id — soft delete, author-only
// ============================================================

router.delete(
  '/comments/:id',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as
      | { id: number; author_user_id: number }
      | undefined;
    if (!row) throw notFound('Comment not found');
    if (row.author_user_id !== req.user!.id) throw forbidden("Only the comment's author may delete it");

    db.prepare(
      `UPDATE comments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), body = '[deleted]' WHERE id = ?`,
    ).run(id);

    res.status(204).send();
  }),
);

export default router;
