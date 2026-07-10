// Flags: reporting + admin resolution for ai_output/edge quality issues. Spec §13.7, §4.5.
//
// Mounted at /api/flags by index.ts. Routes are relative to that mount: '/', '/:id/resolve'.

import { Router } from 'express';
import { db, runInTransaction } from '../db.js';
import { wrapAsync, notFound, validationError, invalidTransition } from '../lib/errors.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import type { Flag, FlagStatus, FlagTargetType } from '../../../shared/types.js';

const router = Router();

// ---------- small local helpers ----------

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(100, Math.floor(n));
}

function parseOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function getFlagRow(id: number): Flag | undefined {
  return db.prepare('SELECT * FROM flags WHERE id = ?').get(id) as Flag | undefined;
}

// ---------- POST / ----------

router.post(
  '/',
  requireAuth,
  wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as { target_type?: unknown; target_id?: unknown; reason?: unknown };
    if (body.target_type !== 'ai_output' && body.target_type !== 'edge') {
      throw validationError("target_type must be 'ai_output' or 'edge'");
    }
    const targetType = body.target_type as FlagTargetType;

    const targetId = Number(body.target_id);
    if (!Number.isInteger(targetId) || targetId <= 0) throw validationError('target_id must be a positive integer');

    if (typeof body.reason !== 'string' || !body.reason.trim()) throw validationError('reason is required');
    const reason = body.reason.trim();

    const table = targetType === 'ai_output' ? 'ai_outputs' : 'edges';
    const exists = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(targetId);
    if (!exists) throw notFound('Flag target not found');

    const flagId = runInTransaction(() => {
      const info = db
        .prepare(`INSERT INTO flags (target_type, target_id, reporter_user_id, reason) VALUES (?, ?, ?, ?)`)
        .run(targetType, targetId, req.user!.id, reason);
      const id = Number(info.lastInsertRowid);
      // Only ai_output targets flip status at flag-creation time; edges have no 'flagged'
      // state in their enum (suggested/confirmed/disputed/rejected) — an edge flag only
      // affects the edge on resolution (upheld+remove -> rejected).
      if (targetType === 'ai_output') {
        db.prepare(`UPDATE ai_outputs SET status = 'flagged' WHERE id = ? AND status = 'active'`).run(targetId);
      }
      return id;
    });

    res.status(201).json({ flag: getFlagRow(flagId) });
  }),
);

// ---------- GET / (admin) ----------

router.get(
  '/',
  requireAuth,
  requireAdmin,
  wrapAsync(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const targetType = typeof req.query.target_type === 'string' ? req.query.target_type : undefined;
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (targetType) {
      conditions.push('target_type = ?');
      params.push(targetType);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = (db.prepare(`SELECT COUNT(*) AS c FROM flags ${where}`).get(...params) as { c: number }).c;
    const rows = db
      .prepare(`SELECT * FROM flags ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Flag[];

    res.json({ items: rows, total, limit, offset });
  }),
);

// ---------- POST /:id/resolve (admin) ----------

router.post(
  '/:id/resolve',
  requireAuth,
  requireAdmin,
  wrapAsync(async (req, res) => {
    const flagId = parseId(req.params.id);
    if (flagId === null) throw notFound('Flag not found');
    const flag = getFlagRow(flagId);
    if (!flag) throw notFound('Flag not found');
    if (flag.status !== 'open') throw invalidTransition('Flag has already been resolved');

    const body = (req.body ?? {}) as { status?: unknown; resolution_note?: unknown; action?: unknown };
    if (body.status !== 'upheld' && body.status !== 'dismissed') {
      throw validationError("status must be 'upheld' or 'dismissed'");
    }
    const resolveStatus = body.status as FlagStatus;

    if (body.action !== undefined && body.action !== 'remove' && body.action !== 'keep') {
      throw validationError("action must be 'remove' or 'keep'");
    }
    const action = body.action as 'remove' | 'keep' | undefined;
    const resolutionNote = typeof body.resolution_note === 'string' ? body.resolution_note : null;

    runInTransaction(() => {
      db.prepare(
        `UPDATE flags SET status = ?, resolved_by = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), resolution_note = ?
         WHERE id = ?`,
      ).run(resolveStatus, req.user!.id, resolutionNote, flagId);

      if (resolveStatus === 'dismissed') {
        if (flag.target_type === 'ai_output') {
          db.prepare(`UPDATE ai_outputs SET status = 'active' WHERE id = ? AND status = 'flagged'`).run(flag.target_id);
        }
        // edges: nothing was changed at flag-creation time, so nothing to revert.
      } else if (resolveStatus === 'upheld' && action === 'remove') {
        if (flag.target_type === 'ai_output') {
          db.prepare(`UPDATE ai_outputs SET status = 'removed' WHERE id = ?`).run(flag.target_id);
        } else {
          db.prepare(`UPDATE edges SET status = 'rejected' WHERE id = ?`).run(flag.target_id);
        }
      }
      // upheld + 'keep' (or no action given): target status is left as-is (ai_output stays
      // 'flagged' pending a correcting PATCH /api/ai/:id; edge status is untouched).
    });

    res.json({ flag: getFlagRow(flagId) });
  }),
);

export default router;
