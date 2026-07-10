// AI trust boundary routes. Spec §7 (whole section), §13.6, §19.1.
//
// Mounted at /api by index.ts. This router owns /works/:id/ai/*, /works/:id/ai, /ai/:id,
// and /ai/track-record.

import { Router } from 'express';
import { db, runInTransaction } from '../db.js';
import { wrapAsync, notFound, validationError, forbidden } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { canAiTransformFullText } from '../lib/license.js';
import { getWork, getWorkDetail, toSummary } from '../services/workStore.js';
import { getAiProvider, getAiProviderName, MODEL_INFO } from '../services/aiProvider.js';
import { EDGE_TYPES } from '../../../shared/types.js';
import type {
  AiFeature,
  AiOutput,
  AiOutputStatus,
  EdgeDetail,
  EdgeType,
  Work,
  WorkDetail,
  WorkSummary,
} from '../../../shared/types.js';

const router = Router();

// ---------- small local helpers ----------

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function tokenizeTitle(title: string): string[] {
  const seen = new Set<string>();
  for (const raw of title.toLowerCase().split(/\W+/)) {
    if (raw) seen.add(raw);
  }
  return Array.from(seen);
}

/**
 * §13.6 suggest-edges candidate pool: top 20 by FTS bm25 match on the work's title terms
 * (each term double-quote-escaped so FTS5 treats it as a literal token, OR-joined so any
 * shared title term counts as a match), excluding the work itself. Falls back to the 20
 * most recent works when the FTS query yields nothing (short/generic titles, no matches, etc).
 */
function candidateWorks(work: Work): WorkSummary[] {
  const terms = tokenizeTitle(work.title);
  let rows: Work[] = [];
  if (terms.length > 0) {
    const matchQuery = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
    rows = db
      .prepare(
        `SELECT works.* FROM works_fts JOIN works ON works.id = works_fts.rowid
         WHERE works_fts MATCH ? AND works.id != ?
         ORDER BY bm25(works_fts) ASC LIMIT 20`,
      )
      .all(matchQuery, work.id) as Work[];
  }
  if (rows.length === 0) {
    rows = db.prepare(`SELECT * FROM works WHERE id != ? ORDER BY created_at DESC LIMIT 20`).all(work.id) as Work[];
  }
  return rows.map(toSummary);
}

type EdgeRow = {
  id: number;
  source_work_id: number;
  target_work_id: number;
  source_subunit_id: number | null;
  target_subunit_id: number | null;
  type: EdgeType;
  origin: 'human' | 'ai';
  asserted_by_user: number | null;
  model: string | null;
  model_version: string | null;
  confidence: number | null;
  basis: string | null;
  status: 'suggested' | 'confirmed' | 'disputed' | 'rejected';
  confirmed_by: number | null;
  confirmed_at: string | null;
  created_at: string;
};

/**
 * Self-contained EdgeDetail builder (mirrors routes/edges.ts's shape) — ai.ts inserts
 * AI-suggested edges directly rather than depending on another router's internals.
 */
function loadEdgeDetail(edgeId: number, currentUserId: number | null): EdgeDetail {
  const row = db
    .prepare(
      `SELECT e.*, sw.title AS source_title, tw.title AS target_title
       FROM edges e
       JOIN works sw ON sw.id = e.source_work_id
       JOIN works tw ON tw.id = e.target_work_id
       WHERE e.id = ?`,
    )
    .get(edgeId) as EdgeRow & { source_title: string; target_title: string };

  const counts = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0) AS up,
              COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0) AS down
       FROM edge_votes WHERE edge_id = ?`,
    )
    .get(edgeId) as { up: number; down: number };

  let my_vote: -1 | 0 | 1 = 0;
  if (currentUserId !== null) {
    const mine = db.prepare('SELECT vote FROM edge_votes WHERE edge_id = ? AND user_id = ?').get(edgeId, currentUserId) as
      | { vote: 1 | -1 }
      | undefined;
    if (mine) my_vote = mine.vote;
  }

  const { source_title, target_title, ...edge } = row;
  return { ...edge, votes: { up: counts.up, down: counts.down, my_vote }, source_title, target_title };
}

interface AiOutputRow {
  id: number;
  work_id: number;
  feature: AiFeature;
  content: string;
  model: string;
  model_version: string;
  status: AiOutputStatus;
  edited_by: number | null;
  edited_at: string | null;
  previous_output_id: number | null;
  is_current: number;
  created_at: string;
}

function getAiOutputRow(id: number): AiOutputRow | undefined {
  return db.prepare('SELECT * FROM ai_outputs WHERE id = ?').get(id) as AiOutputRow | undefined;
}

function toAiOutput(row: AiOutputRow): AiOutput {
  return { ...row, is_current: row.is_current === 1 };
}

/**
 * §15.1 invariant, defense in depth: for 'abstract' scope, return a WorkDetail whose
 * current_version.content.sections is physically []. The provider never sees full text
 * unless canAiTransformFullText(work.tier) — this makes that true by construction rather
 * than by the provider's good behavior.
 */
function scopedWorkDetail(workId: number, scope: 'abstract' | 'full'): WorkDetail {
  const detail = getWorkDetail(workId);
  if (!detail) throw notFound('Work not found');
  if (scope === 'full' || !detail.current_version) return detail;
  return {
    ...detail,
    current_version: { ...detail.current_version, content: { ...detail.current_version.content, sections: [] } },
  };
}

/**
 * Inserts a new current ai_outputs row for (work, feature). For summary/glossary the
 * prior current row is retired (one live output per feature); explainer rows accumulate —
 * each Q&A is independent (§7.3 FAQ semantics), so a new question never hides an old answer.
 */
function insertAiOutput(workId: number, feature: AiFeature, content: string): AiOutputRow {
  const { model, model_version } = MODEL_INFO[getAiProviderName()];
  return runInTransaction(() => {
    if (feature !== 'explainer') {
      db.prepare(`UPDATE ai_outputs SET is_current = 0 WHERE work_id = ? AND feature = ? AND is_current = 1`).run(
        workId,
        feature,
      );
    }
    const info = db
      .prepare(
        `INSERT INTO ai_outputs (work_id, feature, content, model, model_version, status, is_current)
         VALUES (?, ?, ?, ?, ?, 'active', 1)`,
      )
      .run(workId, feature, content, model, model_version);
    return getAiOutputRow(Number(info.lastInsertRowid))!;
  });
}

// ---------- POST /works/:id/ai/suggest-edges ----------

router.post(
  '/works/:id/ai/suggest-edges',
  requireAuth,
  wrapAsync(async (req, res) => {
    const workId = parseId(req.params.id);
    if (workId === null) throw notFound('Work not found');
    const work = getWork(workId);
    if (!work) throw notFound('Work not found');

    const detail = getWorkDetail(workId)!;
    const candidates = candidateWorks(work);
    const candidateIds = new Set(candidates.map((c) => c.id));

    const suggestions = await getAiProvider().suggestEdges(detail, candidates);
    const { model, model_version } = MODEL_INFO[getAiProviderName()];

    const existsStmt = db.prepare(`SELECT 1 FROM edges WHERE source_work_id = ? AND target_work_id = ? AND type = ?`);
    const insertStmt = db.prepare(
      `INSERT INTO edges (source_work_id, target_work_id, type, origin, model, model_version, confidence, basis, status)
       VALUES (?, ?, ?, 'ai', ?, ?, ?, ?, 'suggested')`,
    );

    const items: EdgeDetail[] = runInTransaction(() => {
      const created: EdgeDetail[] = [];
      for (const s of suggestions) {
        // Defensive: never trust the provider blindly, even though both providers are only
        // supposed to reference ids drawn from `candidates`.
        if (!candidateIds.has(s.target_work_id) || s.target_work_id === workId) continue;
        if (!(EDGE_TYPES as string[]).includes(s.type)) continue;
        if (typeof s.confidence !== 'number' || Number.isNaN(s.confidence)) continue;
        if (existsStmt.get(workId, s.target_work_id, s.type)) continue; // §19.1 dedupe on (source,target,type)

        const confidence = Math.max(0, Math.min(1, s.confidence));
        const basis = typeof s.basis === 'string' && s.basis.trim() ? s.basis : 'AI-suggested edge';
        // origin='ai', status ALWAYS 'suggested' — invariant §15.2, never any other initial status.
        const info = insertStmt.run(workId, s.target_work_id, s.type, model, model_version, confidence, basis);
        created.push(loadEdgeDetail(Number(info.lastInsertRowid), req.user!.id));
      }
      return created;
    });

    res.status(201).json({ items });
  }),
);

// ---------- POST /works/:id/ai/summarize ----------

router.post(
  '/works/:id/ai/summarize',
  requireAuth,
  wrapAsync(async (req, res) => {
    const workId = parseId(req.params.id);
    if (workId === null) throw notFound('Work not found');
    const work = getWork(workId);
    if (!work) throw notFound('Work not found');

    const scope: 'abstract' | 'full' = canAiTransformFullText(work.tier) ? 'full' : 'abstract';
    const detail = scopedWorkDetail(workId, scope);

    const content = await getAiProvider().summarize(detail, scope);
    const row = insertAiOutput(workId, 'summary', content);
    res.status(201).json({ output: toAiOutput(row) });
  }),
);

// ---------- POST /works/:id/ai/glossary ----------

router.post(
  '/works/:id/ai/glossary',
  requireAuth,
  wrapAsync(async (req, res) => {
    const workId = parseId(req.params.id);
    if (workId === null) throw notFound('Work not found');
    const work = getWork(workId);
    if (!work) throw notFound('Work not found');

    const scope: 'abstract' | 'full' = canAiTransformFullText(work.tier) ? 'full' : 'abstract';
    const detail = scopedWorkDetail(workId, scope);

    const entries = await getAiProvider().glossary(detail, scope);
    const row = insertAiOutput(workId, 'glossary', JSON.stringify(entries));
    res.status(201).json({ output: toAiOutput(row) });
  }),
);

// ---------- POST /works/:id/ai/explain ----------

router.post(
  '/works/:id/ai/explain',
  requireAuth,
  wrapAsync(async (req, res) => {
    const workId = parseId(req.params.id);
    if (workId === null) throw notFound('Work not found');
    const work = getWork(workId);
    if (!work) throw notFound('Work not found');

    const body = (req.body ?? {}) as { question?: unknown; subunit_id?: unknown };
    if (typeof body.question !== 'string' || !body.question.trim()) throw validationError('question is required');
    const question = body.question.trim();

    let subunitId: number | null = null;
    if (body.subunit_id !== undefined && body.subunit_id !== null) {
      const n = Number(body.subunit_id);
      if (!Number.isInteger(n)) throw validationError('subunit_id must be an integer');
      const exists = db.prepare('SELECT 1 FROM subunits WHERE id = ? AND work_id = ?').get(n, workId);
      if (!exists) throw notFound('Subunit not found');
      subunitId = n;
    }

    const scope: 'abstract' | 'full' = canAiTransformFullText(work.tier) ? 'full' : 'abstract';
    const detail = scopedWorkDetail(workId, scope);

    const answer = await getAiProvider().explain(detail, scope, question, subunitId);
    const row = insertAiOutput(workId, 'explainer', JSON.stringify({ question, answer }));
    res.status(201).json({ output: toAiOutput(row) });
  }),
);

// ---------- GET /works/:id/ai ----------

router.get(
  '/works/:id/ai',
  wrapAsync(async (req, res) => {
    const workId = parseId(req.params.id);
    if (workId === null) throw notFound('Work not found');
    const work = getWork(workId);
    if (!work) throw notFound('Work not found');

    const feature = typeof req.query.feature === 'string' ? req.query.feature : undefined;
    if (feature && !['summary', 'glossary', 'explainer'].includes(feature)) {
      throw validationError("feature must be one of 'summary', 'glossary', 'explainer'");
    }

    const rows = feature
      ? (db
          .prepare(
            `SELECT * FROM ai_outputs WHERE work_id = ? AND feature = ? AND is_current = 1 AND status != 'removed'
             ORDER BY created_at DESC`,
          )
          .all(workId, feature) as AiOutputRow[])
      : (db
          .prepare(
            `SELECT * FROM ai_outputs WHERE work_id = ? AND is_current = 1 AND status != 'removed'
             ORDER BY created_at DESC`,
          )
          .all(workId) as AiOutputRow[]);

    res.json({ items: rows.map(toAiOutput) });
  }),
);

// ---------- GET /ai/track-record ----------
// Registered before PATCH /ai/:id per spec route-order requirement.

router.get(
  '/ai/track-record',
  wrapAsync(async (req, res) => {
    const featureFilter = typeof req.query.feature === 'string' ? req.query.feature : undefined;

    const rows = db
      .prepare(
        `SELECT ao.feature AS feature, f.status AS status, COUNT(*) AS c
         FROM flags f
         JOIN ai_outputs ao ON ao.id = f.target_id AND f.target_type = 'ai_output'
         GROUP BY ao.feature, f.status`,
      )
      .all() as Array<{ feature: AiFeature; status: 'open' | 'upheld' | 'dismissed'; c: number }>;

    const byFeature: Record<AiFeature, { feature: AiFeature; open: number; upheld: number; dismissed: number }> = {
      summary: { feature: 'summary', open: 0, upheld: 0, dismissed: 0 },
      glossary: { feature: 'glossary', open: 0, upheld: 0, dismissed: 0 },
      explainer: { feature: 'explainer', open: 0, upheld: 0, dismissed: 0 },
    };
    for (const r of rows) {
      if (byFeature[r.feature]) byFeature[r.feature][r.status] = r.c;
    }

    const items = Object.values(byFeature).filter((item) => !featureFilter || item.feature === featureFilter);
    res.json({ items });
  }),
);

// ---------- PATCH /ai/:id ----------

router.patch(
  '/ai/:id',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) throw notFound('AI output not found');
    const existing = getAiOutputRow(id);
    if (!existing) throw notFound('AI output not found');
    if (existing.status === 'removed') throw forbidden('Cannot edit a removed AI output');

    const body = (req.body ?? {}) as { content?: unknown };
    if (typeof body.content !== 'string' || !body.content.trim()) throw validationError('content is required');
    const content = body.content;

    const row = runInTransaction(() => {
      db.prepare('UPDATE ai_outputs SET is_current = 0 WHERE id = ?').run(id);
      const info = db
        .prepare(
          `INSERT INTO ai_outputs
             (work_id, feature, content, model, model_version, status, edited_by, edited_at, previous_output_id, is_current)
           VALUES (?, ?, ?, ?, ?, 'active', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, 1)`,
        )
        .run(existing.work_id, existing.feature, content, existing.model, existing.model_version, req.user!.id, id);
      return getAiOutputRow(Number(info.lastInsertRowid))!;
    });

    res.json({ output: toAiOutput(row) });
  }),
);

export default router;
