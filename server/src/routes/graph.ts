// GET /api/graph/:workId — spec §11, §13.11. Public, no auth.
import { Router } from 'express';
import { db } from '../db.js';
import { notFound, validationError, wrapAsync } from '../lib/errors.js';
import { EDGE_TYPES } from '../../../shared/types.js';
import type { EdgeType, GraphEdge, GraphNode, GraphResponse } from '../../../shared/types.js';

const router = Router();

const MAX_NODES = 500;
const MAX_EDGES = 2000;

type Direction = 'ancestors' | 'descendants' | 'both';

interface EdgeRow {
  id: number;
  source_work_id: number;
  target_work_id: number;
  type: EdgeType;
  origin: 'human' | 'ai';
  status: 'suggested' | 'confirmed' | 'disputed' | 'rejected';
  confidence: number | null;
}

/** Shared query-param parsing for both graph endpoints. */
function parseGraphFilters(req: { query: Record<string, unknown> }): {
  types: EdgeType[] | undefined;
  includeAi: boolean;
} {
  let types: EdgeType[] | undefined;
  const rawTypes = req.query.types;
  if (typeof rawTypes === 'string' && rawTypes.length > 0) {
    const requested = rawTypes
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const t of requested) {
      if (!(EDGE_TYPES as string[]).includes(t)) {
        throw validationError(`Unknown edge type: ${t}`);
      }
    }
    types = requested as EdgeType[];
  }
  return { types, includeAi: req.query.include_ai === 'true' };
}

// GET /api/graph — field-wide overview: the most-connected works and every edge
// among them, so the whole uploaded corpus can be explored without picking a root.
router.get(
  '/',
  wrapAsync(async (req, res) => {
    const { types, includeAi } = parseGraphFilters(req as { query: Record<string, unknown> });

    const nodeRows = db
      .prepare(
        `SELECT w.id, w.kind, w.title, w.result_nature, w.tier,
                (SELECT COUNT(*) FROM edges e
                 WHERE (e.source_work_id = w.id OR e.target_work_id = w.id) AND e.status != 'rejected') AS degree
         FROM works w
         ORDER BY degree DESC, w.created_at DESC
         LIMIT ?`,
      )
      .all(MAX_NODES + 1) as (GraphNode & { degree: number })[];

    const truncatedNodes = nodeRows.length > MAX_NODES;
    const nodes: GraphNode[] = nodeRows
      .slice(0, MAX_NODES)
      .map(({ degree: _degree, ...n }) => n);
    const idList = nodes.map((n) => n.id);

    let edges: GraphEdge[] = [];
    let truncatedEdges = false;
    if (idList.length > 0) {
      const aiClause = includeAi ? '' : `AND NOT (origin = 'ai' AND status = 'suggested')`;
      const typeClause = types && types.length > 0 ? `AND type IN (${types.map(() => '?').join(',')})` : '';
      const placeholders = idList.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT id, source_work_id, target_work_id, type, origin, status, confidence
           FROM edges
           WHERE status != 'rejected' ${aiClause} ${typeClause}
             AND source_work_id IN (${placeholders}) AND target_work_id IN (${placeholders})
           LIMIT ?`,
        )
        .all(...(types ?? []), ...idList, ...idList, MAX_EDGES + 1) as EdgeRow[];
      truncatedEdges = rows.length > MAX_EDGES;
      edges = rows.slice(0, MAX_EDGES).map((e) => ({
        id: e.id,
        source_work_id: e.source_work_id,
        target_work_id: e.target_work_id,
        type: e.type,
        origin: e.origin,
        status: e.status,
        confidence: e.confidence,
      }));
    }

    const response: GraphResponse = {
      root_id: null,
      nodes,
      edges,
      truncated: truncatedNodes || truncatedEdges,
    };
    res.json(response);
  }),
);

router.get(
  '/:workId',
  wrapAsync(async (req, res) => {
    const rootId = Number(req.params.workId);
    if (!Number.isInteger(rootId) || rootId <= 0) {
      throw validationError('workId must be a positive integer');
    }

    const depthParam = req.query.depth;
    const depth = depthParam === undefined ? 1 : Number(depthParam);
    if (!Number.isInteger(depth) || depth < 1 || depth > 3) {
      throw validationError('depth must be an integer between 1 and 3');
    }

    const direction: Direction = typeof req.query.direction === 'string' ? (req.query.direction as Direction) : 'both';
    if (direction !== 'ancestors' && direction !== 'descendants' && direction !== 'both') {
      throw validationError("direction must be one of 'ancestors', 'descendants', 'both'");
    }

    let types: EdgeType[] | undefined;
    if (typeof req.query.types === 'string' && req.query.types.length > 0) {
      const requested = req.query.types
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      for (const t of requested) {
        if (!(EDGE_TYPES as string[]).includes(t)) {
          throw validationError(`Unknown edge type: ${t}`);
        }
      }
      types = requested as EdgeType[];
    }

    const includeAi = req.query.include_ai === 'true';

    const rootWork = db.prepare('SELECT id FROM works WHERE id = ?').get(rootId) as { id: number } | undefined;
    if (!rootWork) throw notFound('Work not found');

    const aiClause = includeAi ? '' : `AND NOT (origin = 'ai' AND status = 'suggested')`;
    const typeClause = types && types.length > 0 ? `AND type IN (${types.map(() => '?').join(',')})` : '';
    const baseClause = `status != 'rejected' ${aiClause} ${typeClause}`;

    const outStmt = db.prepare(
      `SELECT id, source_work_id, target_work_id, type, origin, status, confidence
       FROM edges WHERE source_work_id = ? AND ${baseClause}`,
    );
    const inStmt = db.prepare(
      `SELECT id, source_work_id, target_work_id, type, origin, status, confidence
       FROM edges WHERE target_work_id = ? AND ${baseClause}`,
    );
    const typeParams = types ?? [];

    const nodeIds = new Set<number>([rootId]);
    const edgesById = new Map<number, EdgeRow>();
    let truncated = false;
    let frontier: number[] = [rootId];

    outer: for (let hop = 0; hop < depth; hop++) {
      if (frontier.length === 0) break;
      const nextFrontier: number[] = [];

      for (const current of frontier) {
        const rows: EdgeRow[] = [];
        if (direction === 'descendants' || direction === 'both') {
          rows.push(...(outStmt.all(current, ...typeParams) as EdgeRow[]));
        }
        if (direction === 'ancestors' || direction === 'both') {
          rows.push(...(inStmt.all(current, ...typeParams) as EdgeRow[]));
        }

        for (const edge of rows) {
          if (edgesById.has(edge.id)) continue;
          const neighbor = edge.source_work_id === current ? edge.target_work_id : edge.source_work_id;
          const neighborIsNew = !nodeIds.has(neighbor);

          if (neighborIsNew && nodeIds.size >= MAX_NODES) {
            truncated = true;
            continue; // would exceed node cap; skip to avoid a dangling edge
          }
          if (edgesById.size >= MAX_EDGES) {
            truncated = true;
            break outer;
          }

          edgesById.set(edge.id, edge);
          if (neighborIsNew) {
            nodeIds.add(neighbor);
            nextFrontier.push(neighbor);
          }
        }
      }

      frontier = nextFrontier;
    }

    const idList = Array.from(nodeIds);
    const nodes = db
      .prepare(
        `SELECT id, kind, title, result_nature, tier FROM works WHERE id IN (${idList.map(() => '?').join(',')})`,
      )
      .all(...idList) as GraphNode[];

    const edges: GraphEdge[] = Array.from(edgesById.values()).map((e) => ({
      id: e.id,
      source_work_id: e.source_work_id,
      target_work_id: e.target_work_id,
      type: e.type,
      origin: e.origin,
      status: e.status,
      confidence: e.confidence,
    }));

    const response: GraphResponse = { root_id: rootId, nodes, edges, truncated };
    res.json(response);
  }),
);

export default router;
