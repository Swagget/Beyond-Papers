// Typed edges: AI suggestion + human assertion/promotion, status state machine, votes.
// Spec: docs/ARCHITECTURE.md §13.4, §7.3 (AI trust boundary / status state machine),
// §19.1 (UNIQUE(source_work_id,target_work_id,type) triple handling).
//
// Mounted at /api by index.ts. This router owns both /edges... and /works/:id/edges.

import { Router } from 'express';
import { db, nowIso, runInTransaction } from '../db.js';
import {
  wrapAsync,
  validationError,
  notFound,
  conflict,
  invalidTransition,
} from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { getWork } from '../services/workStore.js';
import { EDGE_TYPES } from '../../../shared/types.js';
import type { Edge, EdgeDetail, EdgeType, EdgeStatus } from '../../../shared/types.js';

const router = Router();

const EDGE_STATUSES: EdgeStatus[] = ['suggested', 'confirmed', 'disputed', 'rejected'];
type EdgeDirection = 'out' | 'in' | 'both';

// ---------- helpers ----------

type EdgeRow = Edge;

/**
 * One query for the edge row + source/target work titles, plus vote aggregates and the
 * requesting user's own vote. Shared by every route below so response shape stays consistent.
 */
function edgeDetail(edgeId: number, currentUserId: number | null): EdgeDetail | undefined {
  const row = db
    .prepare(
      `SELECT e.*, sw.title AS source_title, tw.title AS target_title
       FROM edges e
       JOIN works sw ON sw.id = e.source_work_id
       JOIN works tw ON tw.id = e.target_work_id
       WHERE e.id = ?`,
    )
    .get(edgeId) as (EdgeRow & { source_title: string; target_title: string }) | undefined;
  if (!row) return undefined;

  const counts = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0) AS up,
         COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0) AS down
       FROM edge_votes WHERE edge_id = ?`,
    )
    .get(edgeId) as { up: number; down: number };

  let my_vote: -1 | 0 | 1 = 0;
  if (currentUserId !== null) {
    const mine = db
      .prepare('SELECT vote FROM edge_votes WHERE edge_id = ? AND user_id = ?')
      .get(edgeId, currentUserId) as { vote: 1 | -1 } | undefined;
    if (mine) my_vote = mine.vote;
  }

  const { source_title, target_title, ...edge } = row;
  return {
    ...edge,
    votes: { up: counts.up, down: counts.down, my_vote },
    source_title,
    target_title,
  };
}

function getEdgeRow(id: number): EdgeRow | undefined {
  return db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as EdgeRow | undefined;
}

function toRequiredInt(value: unknown, field: string): number {
  const n = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isInteger(n)) {
    throw validationError(`${field} must be an integer`);
  }
  return n;
}

function toOptionalInt(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isInteger(n)) throw validationError(`${field} must be an integer`);
  return n;
}

function toIdParam(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) throw notFound('Edge not found');
  return id;
}

/** Normalize an Express query value that may be string | string[] | undefined into one string. */
function queryString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v.join(',');
  return undefined;
}

// ---------- POST /edges ----------

router.post(
  '/edges',
  requireAuth,
  wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const sourceWorkId = toRequiredInt(body.source_work_id, 'source_work_id');
    const targetWorkId = toRequiredInt(body.target_work_id, 'target_work_id');

    const type = body.type;
    if (typeof type !== 'string' || !EDGE_TYPES.includes(type as EdgeType)) {
      throw validationError(`type must be one of: ${EDGE_TYPES.join(', ')}`);
    }

    const sourceSubunitId = toOptionalInt(body.source_subunit_id, 'source_subunit_id');
    const targetSubunitId = toOptionalInt(body.target_subunit_id, 'target_subunit_id');
    const basis = typeof body.basis === 'string' ? body.basis : null;

    const sourceWork = getWork(sourceWorkId);
    if (!sourceWork) throw notFound(`Work ${sourceWorkId} not found`);
    const targetWork = getWork(targetWorkId);
    if (!targetWork) throw notFound(`Work ${targetWorkId} not found`);

    // Self-loop only forbidden when the subunit anchors don't distinguish source from target
    // (mirrors the schema CHECK: source=target AND source_subunit_id IS target_subunit_id).
    if (sourceWorkId === targetWorkId && sourceSubunitId === targetSubunitId) {
      throw validationError('Self-loop edges require distinct source/target subunit anchors');
    }

    if (sourceSubunitId !== null) {
      const row = db.prepare('SELECT work_id FROM subunits WHERE id = ?').get(sourceSubunitId) as
        | { work_id: number }
        | undefined;
      if (!row || row.work_id !== sourceWorkId) {
        throw validationError('source_subunit_id must belong to source_work_id');
      }
    }
    if (targetSubunitId !== null) {
      const row = db.prepare('SELECT work_id FROM subunits WHERE id = ?').get(targetSubunitId) as
        | { work_id: number }
        | undefined;
      if (!row || row.work_id !== targetWorkId) {
        throw validationError('target_subunit_id must belong to target_work_id');
      }
    }

    const userId = req.user!.id;
    const now = nowIso();

    // Human assertions are confirmed on arrival (§7.3) — not a suggestion needing promotion.
    const outcome = runInTransaction((): { status: 200 | 201; edgeId: number } => {
      const existing = db
        .prepare('SELECT * FROM edges WHERE source_work_id = ? AND target_work_id = ? AND type = ?')
        .get(sourceWorkId, targetWorkId, type) as EdgeRow | undefined;

      if (existing) {
        // §19.1: UNIQUE(source,target,type). An existing AI *suggestion* is promoted by this
        // human assertion — origin stays 'ai' so provenance is preserved. Anything else conflicts.
        if (existing.status === 'suggested') {
          db.prepare(`UPDATE edges SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?`).run(
            userId,
            now,
            existing.id,
          );
          return { status: 200, edgeId: existing.id };
        }
        throw conflict(`An edge of type '${type}' already exists between these works`);
      }

      const result = db
        .prepare(
          `INSERT INTO edges (source_work_id, target_work_id, source_subunit_id, target_subunit_id, type,
                              origin, asserted_by_user, basis, status, confirmed_by, confirmed_at)
           VALUES (?, ?, ?, ?, ?, 'human', ?, ?, 'confirmed', ?, ?)`,
        )
        .run(sourceWorkId, targetWorkId, sourceSubunitId, targetSubunitId, type, userId, basis, userId, now);
      return { status: 201, edgeId: Number(result.lastInsertRowid) };
    });

    res.status(outcome.status).json({ edge: edgeDetail(outcome.edgeId, userId) });
  }),
);

// ---------- GET /edges/:id ----------

router.get(
  '/edges/:id',
  wrapAsync(async (req, res) => {
    const id = toIdParam(req.params.id);
    const detail = edgeDetail(id, req.user?.id ?? null);
    if (!detail) throw notFound('Edge not found');
    res.json({ edge: detail });
  }),
);

// ---------- GET /works/:id/edges ----------

router.get(
  '/works/:id/edges',
  wrapAsync(async (req, res) => {
    const workId = Number(req.params.id);
    if (!Number.isInteger(workId)) throw notFound('Work not found');

    const direction = (queryString(req.query.direction) ?? 'both') as EdgeDirection;
    if (direction !== 'out' && direction !== 'in' && direction !== 'both') {
      throw validationError('direction must be one of: out, in, both');
    }

    const typeCsv = queryString(req.query.type);
    let types: string[] | undefined;
    if (typeCsv) {
      types = typeCsv
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      for (const t of types) {
        if (!EDGE_TYPES.includes(t as EdgeType)) throw validationError(`Invalid edge type: ${t}`);
      }
    }

    const statusCsv = queryString(req.query.status);
    let statuses: string[] | undefined;
    if (statusCsv) {
      statuses = statusCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const s of statuses) {
        if (!EDGE_STATUSES.includes(s as EdgeStatus)) throw validationError(`Invalid edge status: ${s}`);
      }
    }

    const includeAiRaw = queryString(req.query.include_ai);
    const includeAi = includeAiRaw === 'true' || includeAiRaw === '1';

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (direction === 'out') {
      clauses.push('e.source_work_id = ?');
      params.push(workId);
    } else if (direction === 'in') {
      clauses.push('e.target_work_id = ?');
      params.push(workId);
    } else {
      clauses.push('(e.source_work_id = ? OR e.target_work_id = ?)');
      params.push(workId, workId);
    }

    if (types && types.length > 0) {
      clauses.push(`e.type IN (${types.map(() => '?').join(',')})`);
      params.push(...types);
    }

    // Default status filter (§13.4): always exclude 'rejected' unless explicitly requested;
    // §4.2 trust boundary: always exclude origin='ai' AND status='suggested' unless include_ai=true.
    if (statuses && statuses.length > 0) {
      clauses.push(`e.status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
      if (!statuses.includes('rejected')) {
        clauses.push(`e.status != 'rejected'`);
      }
    } else {
      clauses.push(`e.status != 'rejected'`);
    }

    if (!includeAi) {
      clauses.push(`NOT (e.origin = 'ai' AND e.status = 'suggested')`);
    }

    const sql = `SELECT e.id FROM edges e WHERE ${clauses.join(' AND ')} ORDER BY e.created_at DESC`;
    const rows = db.prepare(sql).all(...params) as { id: number }[];

    const currentUserId = req.user?.id ?? null;
    const items: EdgeDetail[] = rows.map((r) => edgeDetail(r.id, currentUserId)!);

    res.json({ items });
  }),
);

// ---------- status state machine (§7.3) ----------

router.post(
  '/edges/:id/confirm',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = toIdParam(req.params.id);
    const edge = getEdgeRow(id);
    if (!edge) throw notFound('Edge not found');
    if (edge.status !== 'suggested' && edge.status !== 'disputed') {
      throw invalidTransition(`Cannot confirm an edge with status '${edge.status}'`);
    }
    const userId = req.user!.id;
    const now = nowIso();
    db.prepare(`UPDATE edges SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?`).run(
      userId,
      now,
      id,
    );
    res.json({ edge: edgeDetail(id, userId) });
  }),
);

router.post(
  '/edges/:id/dispute',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = toIdParam(req.params.id);
    const edge = getEdgeRow(id);
    if (!edge) throw notFound('Edge not found');
    if (edge.status !== 'confirmed') {
      throw invalidTransition(`Cannot dispute an edge with status '${edge.status}'`);
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const comment = typeof body.comment === 'string' ? body.comment : null;
    const userId = req.user!.id;

    runInTransaction(() => {
      db.prepare(`UPDATE edges SET status = 'disputed' WHERE id = ?`).run(id);
      if (comment) {
        db.prepare(
          `INSERT INTO edge_votes (edge_id, user_id, vote, comment) VALUES (?, ?, -1, ?)
           ON CONFLICT(edge_id, user_id) DO UPDATE SET vote = excluded.vote, comment = excluded.comment`,
        ).run(id, userId, comment);
      }
    });

    res.json({ edge: edgeDetail(id, userId) });
  }),
);

router.post(
  '/edges/:id/reject',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = toIdParam(req.params.id);
    const edge = getEdgeRow(id);
    if (!edge) throw notFound('Edge not found');
    if (edge.status !== 'suggested' && edge.status !== 'disputed') {
      throw invalidTransition(`Cannot reject an edge with status '${edge.status}'`);
    }
    db.prepare(`UPDATE edges SET status = 'rejected' WHERE id = ?`).run(id);
    res.json({ edge: edgeDetail(id, req.user!.id) });
  }),
);

router.post(
  '/edges/:id/vote',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = toIdParam(req.params.id);
    const edge = db.prepare('SELECT id FROM edges WHERE id = ?').get(id) as { id: number } | undefined;
    if (!edge) throw notFound('Edge not found');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const vote = body.vote;
    if (vote !== 1 && vote !== -1) {
      throw validationError('vote must be 1 or -1');
    }
    const comment = typeof body.comment === 'string' ? body.comment : null;
    const userId = req.user!.id;

    db.prepare(
      `INSERT INTO edge_votes (edge_id, user_id, vote, comment) VALUES (?, ?, ?, ?)
       ON CONFLICT(edge_id, user_id) DO UPDATE SET vote = excluded.vote, comment = excluded.comment`,
    ).run(id, userId, vote, comment);

    res.json({ edge: edgeDetail(id, userId) });
  }),
);

export default router;
