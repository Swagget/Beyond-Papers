// GET /api/search — spec §8, §13.8. Public, no auth.
import { Router } from 'express';
import { db } from '../db.js';
import { validationError, wrapAsync } from '../lib/errors.js';
import { scoreWorks, WEIGHTS, type ScorableWork } from '../services/ranking.js';
import type { SearchResponse } from '../../../shared/types.js';

const router = Router();

// Ranking needs the full candidate batch scored together for a stable min-max relevance
// normalization; re-scoring every matching row on every request would be O(n) queries, so we
// cap the candidate pool. Results beyond this many matches are not individually ranked against
// results further down the true match set (though `total` still reports the true total).
const MAX_CANDIDATES = 200;

function escapeFtsQuery(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(' ');
}

router.get(
  '/',
  wrapAsync(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const resultNature = typeof req.query.result_nature === 'string' ? req.query.result_nature : undefined;
    const tier = typeof req.query.tier === 'string' ? req.query.tier : undefined;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'relevance';
    if (sort !== 'relevance' && sort !== 'newest' && sort !== 'year') {
      throw validationError("sort must be one of 'relevance', 'newest', 'year'");
    }

    const filters: string[] = [];
    const filterParams: unknown[] = [];
    if (kind) {
      filters.push('works.kind = ?');
      filterParams.push(kind);
    }
    if (resultNature) {
      filters.push('works.result_nature = ?');
      filterParams.push(resultNature);
    }
    if (tier) {
      filters.push('works.tier = ?');
      filterParams.push(tier);
    }
    const filterClause = filters.length ? `AND ${filters.join(' AND ')}` : '';

    let total: number;
    let candidateRows: ScorableWork[];

    if (q) {
      const ftsQuery = escapeFtsQuery(q);

      const countRow = db
        .prepare(
          `SELECT COUNT(*) AS c
           FROM works_fts JOIN works ON works.id = works_fts.rowid
           WHERE works_fts MATCH ? ${filterClause}`,
        )
        .get(ftsQuery, ...filterParams) as { c: number };
      total = countRow.c;

      candidateRows = db
        .prepare(
          `SELECT works.*, bm25(works_fts) AS bm25_raw
           FROM works_fts JOIN works ON works.id = works_fts.rowid
           WHERE works_fts MATCH ? ${filterClause}
           ORDER BY bm25(works_fts) ASC
           LIMIT ?`,
        )
        .all(ftsQuery, ...filterParams, MAX_CANDIDATES) as ScorableWork[];
    } else {
      const countRow = db
        .prepare(`SELECT COUNT(*) AS c FROM works WHERE 1=1 ${filterClause}`)
        .get(...filterParams) as { c: number };
      total = countRow.c;

      candidateRows = db
        .prepare(
          `SELECT works.*, NULL AS bm25_raw
           FROM works
           WHERE 1=1 ${filterClause}
           ORDER BY works.created_at DESC
           LIMIT ?`,
        )
        .all(...filterParams, MAX_CANDIDATES) as ScorableWork[];
    }

    const scored = scoreWorks(candidateRows);
    // Non-relevance sorts reorder within the ranked candidate pool (MAX_CANDIDATES cap
    // applies as usual); score components stay attached for transparency.
    if (sort === 'newest') {
      scored.sort((a, b) => b.work.created_at.localeCompare(a.work.created_at));
    } else if (sort === 'year') {
      scored.sort(
        (a, b) => (b.work.publication_year ?? Number.NEGATIVE_INFINITY) - (a.work.publication_year ?? Number.NEGATIVE_INFINITY),
      );
    }
    const items = scored.slice(offset, offset + limit);

    const response: SearchResponse = { items, total, limit, offset, weights: WEIGHTS };
    res.json(response);
  }),
);

export default router;
