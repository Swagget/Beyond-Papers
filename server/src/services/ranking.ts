// Search ranking — spec §8. Pure-ish scoring layer: takes rows already fetched by
// routes/search.ts (works joined with an optional FTS5 bm25 raw score) and returns
// SearchResultItem[] sorted by weighted score, each with its 0..1 component breakdown.

import { db } from '../db.js';
import { toSummary } from './workStore.js';
import type { ScoreComponents, SearchResultItem, Work } from '../../../shared/types.js';

export const WEIGHTS: ScoreComponents = {
  relevance: 0.45,
  rigor: 0.25,
  review_count: 0.15,
  recency: 0.15,
};

export const RIGOR_CAP = 20; // log1p normalization cap for rigor
export const REVIEW_CAP = 10; // log1p normalization cap for review_count
export const RECENCY_HALF_LIFE_DAYS = 730; // 2 years

/** A works row as fetched by routes/search.ts, plus the raw FTS5 bm25 score (null when there was no query). */
export type ScorableWork = Work & { bm25_raw: number | null };

const RIGOR_EDGE_TYPES = ['supports', 'replicates', 'fails_to_replicate'] as const;

interface EdgeCounts {
  supports: number;
  replicates: number;
  fails_to_replicate: number;
  reviews: number;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Grouped counts of CONFIRMED edges targeting each of the given work ids, restricted to the
 * types rigor/review_count care about. Never counts 'suggested'/'disputed'/'rejected' edges
 * (invariant §15.2). Single query regardless of how many works are being scored.
 */
function fetchEdgeCounts(workIds: number[]): Map<number, EdgeCounts> {
  const counts = new Map<number, EdgeCounts>();
  for (const id of workIds) {
    counts.set(id, { supports: 0, replicates: 0, fails_to_replicate: 0, reviews: 0 });
  }
  if (workIds.length === 0) return counts;

  const placeholders = workIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT target_work_id, type, COUNT(*) AS c
       FROM edges
       WHERE status = 'confirmed'
         AND target_work_id IN (${placeholders})
         AND type IN ('supports','replicates','fails_to_replicate','reviews')
       GROUP BY target_work_id, type`,
    )
    .all(...workIds) as Array<{ target_work_id: number; type: string; c: number }>;

  for (const row of rows) {
    const entry = counts.get(row.target_work_id);
    if (!entry) continue;
    if (row.type === 'supports' || row.type === 'replicates' || row.type === 'fails_to_replicate' || row.type === 'reviews') {
      entry[row.type] = row.c;
    }
  }
  return counts;
}

/**
 * Implements §8 exactly:
 * - relevance: min-max normalize -bm25_raw across the given batch of rows (the "page" of
 *   candidates the caller wants ranked together); 1.0 when there was no query (bm25_raw all
 *   null) or when every row ties.
 * - rigor: confirmed supports + replicates - fails_to_replicate targeting the work, clipped at
 *   0, log1p-normalized against RIGOR_CAP.
 * - review_count: confirmed 'reviews' edges targeting the work, log1p-normalized against
 *   REVIEW_CAP.
 * - recency: exponential decay on created_at with RECENCY_HALF_LIFE_DAYS half-life.
 * Returns items sorted by weighted score descending; every component and the score itself is
 * rounded to 4 decimals.
 */
export function scoreWorks(rows: ScorableWork[]): SearchResultItem[] {
  if (rows.length === 0) return [];

  const negBm25 = rows.map((r) => (r.bm25_raw == null ? 0 : -r.bm25_raw));
  const hasQuery = rows.some((r) => r.bm25_raw != null);
  let relevances: number[];
  if (!hasQuery) {
    relevances = rows.map(() => 1);
  } else {
    const min = Math.min(...negBm25);
    const max = Math.max(...negBm25);
    relevances = max === min ? rows.map(() => 1) : negBm25.map((v) => (v - min) / (max - min));
  }

  const counts = fetchEdgeCounts(rows.map((r) => r.id));
  const now = Date.now();

  const items: SearchResultItem[] = rows.map((row, i) => {
    const c = counts.get(row.id) ?? { supports: 0, replicates: 0, fails_to_replicate: 0, reviews: 0 };
    const rigorRaw = Math.max(0, c.supports + c.replicates - c.fails_to_replicate);
    const rigor = Math.min(1, Math.log1p(rigorRaw) / Math.log1p(RIGOR_CAP));
    const review_count = Math.min(1, Math.log1p(c.reviews) / Math.log1p(REVIEW_CAP));
    const ageDays = Math.max(0, (now - new Date(row.created_at).getTime()) / 86_400_000);
    const recency = Math.exp((-Math.LN2 * ageDays) / RECENCY_HALF_LIFE_DAYS);

    const score_components: ScoreComponents = {
      relevance: round4(relevances[i]),
      rigor: round4(rigor),
      review_count: round4(review_count),
      recency: round4(recency),
    };
    const score =
      WEIGHTS.relevance * score_components.relevance +
      WEIGHTS.rigor * score_components.rigor +
      WEIGHTS.review_count * score_components.review_count +
      WEIGHTS.recency * score_components.recency;

    const { bm25_raw: _bm25Raw, ...work } = row;
    return {
      work: toSummary(work),
      score: round4(score),
      score_components,
    };
  });

  items.sort((a, b) => b.score - a.score);
  return items;
}
