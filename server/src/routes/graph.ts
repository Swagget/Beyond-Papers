// GET /api/graph/:workId — spec §11, §13.11. Public, no auth.
import { Router } from 'express';
import { db } from '../db.js';
import { notFound, validationError, wrapAsync } from '../lib/errors.js';
import { EDGE_TYPES, PUBLICATION_STATUSES } from '../../../shared/types.js';
import type { EdgeType, GraphEdge, GraphNode, GraphResponse, PublicationStatus } from '../../../shared/types.js';

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
  publicationStatus: PublicationStatus | undefined;
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
  let publicationStatus: PublicationStatus | undefined;
  const rawStatus = req.query.publication_status;
  if (typeof rawStatus === 'string' && rawStatus.length > 0) {
    if (!(PUBLICATION_STATUSES as string[]).includes(rawStatus)) {
      throw validationError(`publication_status must be one of ${PUBLICATION_STATUSES.join(', ')}`);
    }
    publicationStatus = rawStatus as PublicationStatus;
  }
  return { types, includeAi: req.query.include_ai === 'true', publicationStatus };
}

/** Works rows (with corpus-wide degree) for a set of ids. */
function fetchGraphNodes(idList: number[]): GraphNode[] {
  if (idList.length === 0) return [];
  return db
    .prepare(
      `SELECT w.id, w.kind, w.title, w.result_nature, w.tier, w.publication_status, w.publication_year,
              (SELECT COUNT(*) FROM edges e
               WHERE (e.source_work_id = w.id OR e.target_work_id = w.id) AND e.status != 'rejected') AS degree
       FROM works w WHERE w.id IN (${idList.map(() => '?').join(',')})`,
    )
    .all(...idList) as GraphNode[];
}

/**
 * BFS node discovery from one or more roots, up to `depth` hops, honoring
 * direction/type/AI filters. Returns the reached node ids only — callers fetch
 * every matching edge among the final set so sibling links are never dropped.
 */
function collectNeighborhood(
  rootIds: number[],
  depth: number,
  direction: Direction,
  types: EdgeType[] | undefined,
  includeAi: boolean,
  publicationStatus?: PublicationStatus,
): { nodeIds: Set<number>; truncated: boolean } {
  const aiClause = includeAi ? '' : `AND NOT (origin = 'ai' AND status = 'suggested')`;
  const typeClause = types && types.length > 0 ? `AND type IN (${types.map(() => '?').join(',')})` : '';
  const baseClause = `status != 'rejected' ${aiClause} ${typeClause}`;
  const outStmt = db.prepare(
    `SELECT source_work_id, target_work_id FROM edges WHERE source_work_id = ? AND ${baseClause}`,
  );
  const inStmt = db.prepare(
    `SELECT source_work_id, target_work_id FROM edges WHERE target_work_id = ? AND ${baseClause}`,
  );
  const typeParams = types ?? [];
  // Node-level publication_status constraint applies to discovered neighbors only —
  // roots/focus ids are always kept so a focused view can't erase its own anchor.
  const statusStmt = publicationStatus
    ? db.prepare('SELECT 1 FROM works WHERE id = ? AND publication_status = ?')
    : null;

  const nodeIds = new Set<number>(rootIds);
  let truncated = false;
  let frontier: number[] = [...rootIds];

  for (let hop = 0; hop < depth; hop++) {
    if (frontier.length === 0) break;
    const nextFrontier: number[] = [];
    for (const current of frontier) {
      const rows: Array<{ source_work_id: number; target_work_id: number }> = [];
      if (direction === 'descendants' || direction === 'both') {
        rows.push(...(outStmt.all(current, ...typeParams) as typeof rows));
      }
      if (direction === 'ancestors' || direction === 'both') {
        rows.push(...(inStmt.all(current, ...typeParams) as typeof rows));
      }
      for (const row of rows) {
        const neighbor = row.source_work_id === current ? row.target_work_id : row.source_work_id;
        if (nodeIds.has(neighbor)) continue;
        if (statusStmt && !statusStmt.get(neighbor, publicationStatus)) continue;
        if (nodeIds.size >= MAX_NODES) {
          truncated = true;
          continue;
        }
        nodeIds.add(neighbor);
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }

  return { nodeIds, truncated };
}

/** Every non-rejected edge whose both endpoints are in the set, honoring filters. */
function fetchEdgesAmong(
  idList: number[],
  types: EdgeType[] | undefined,
  includeAi: boolean,
): { edges: GraphEdge[]; truncated: boolean } {
  if (idList.length === 0) return { edges: [], truncated: false };
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
  return {
    truncated: rows.length > MAX_EDGES,
    edges: rows.slice(0, MAX_EDGES).map((e) => ({
      id: e.id,
      source_work_id: e.source_work_id,
      target_work_id: e.target_work_id,
      type: e.type,
      origin: e.origin,
      status: e.status,
      confidence: e.confidence,
    })),
  };
}

const MAX_FOCUS = 50;

/** Parse the focus=1,2,3 work-id list for the overview endpoint. */
function parseFocusIds(raw: unknown): number[] | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const ids = raw.split(',').map((s) => Number(s.trim()));
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw validationError('focus must be a comma-separated list of positive integer work ids');
  }
  if (ids.length > MAX_FOCUS) {
    throw validationError(`focus accepts at most ${MAX_FOCUS} work ids`);
  }
  return Array.from(new Set(ids));
}

// GET /api/graph — field-wide overview: the most-connected works and every edge
// among them, so the whole uploaded corpus can be explored without picking a root.
// With focus=<id,id,...> it instead shows just those works plus everything within
// `depth` hops of them (0 = only the focused works), still honoring all filters.
router.get(
  '/',
  wrapAsync(async (req, res) => {
    const { types, includeAi, publicationStatus } = parseGraphFilters(req as { query: Record<string, unknown> });
    const focusIds = parseFocusIds(req.query.focus);

    if (focusIds) {
      const depthParam = req.query.depth;
      const depth = depthParam === undefined ? 1 : Number(depthParam);
      if (!Number.isInteger(depth) || depth < 0 || depth > 3) {
        throw validationError('depth must be an integer between 0 and 3');
      }

      // Silently drop focus ids that no longer exist (e.g. stale shared links).
      const existing = fetchGraphNodes(focusIds).map((n) => n.id);
      const { nodeIds, truncated: truncatedNodes } = collectNeighborhood(
        existing,
        depth,
        'both',
        types,
        includeAi,
        publicationStatus,
      );
      const idList = Array.from(nodeIds);
      const { edges, truncated: truncatedEdges } = fetchEdgesAmong(idList, types, includeAi);

      const response: GraphResponse = {
        root_id: null,
        nodes: fetchGraphNodes(idList),
        edges,
        truncated: truncatedNodes || truncatedEdges,
      };
      res.json(response);
      return;
    }

    const statusClause = publicationStatus ? 'WHERE w.publication_status = ?' : '';
    const statusParams = publicationStatus ? [publicationStatus] : [];
    const nodeRows = db
      .prepare(
        `SELECT w.id, w.kind, w.title, w.result_nature, w.tier, w.publication_status, w.publication_year,
                (SELECT COUNT(*) FROM edges e
                 WHERE (e.source_work_id = w.id OR e.target_work_id = w.id) AND e.status != 'rejected') AS degree
         FROM works w
         ${statusClause}
         ORDER BY degree DESC, w.created_at DESC
         LIMIT ?`,
      )
      .all(...statusParams, MAX_NODES + 1) as GraphNode[];

    const truncatedNodes = nodeRows.length > MAX_NODES;
    const nodes: GraphNode[] = nodeRows.slice(0, MAX_NODES);
    const { edges, truncated: truncatedEdges } = fetchEdgesAmong(
      nodes.map((n) => n.id),
      types,
      includeAi,
    );

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
    let publicationStatus: PublicationStatus | undefined;
    if (typeof req.query.publication_status === 'string' && req.query.publication_status.length > 0) {
      if (!(PUBLICATION_STATUSES as string[]).includes(req.query.publication_status)) {
        throw validationError(`publication_status must be one of ${PUBLICATION_STATUSES.join(', ')}`);
      }
      publicationStatus = req.query.publication_status as PublicationStatus;
    }

    const rootWork = db.prepare('SELECT id FROM works WHERE id = ?').get(rootId) as { id: number } | undefined;
    if (!rootWork) throw notFound('Work not found');

    const { nodeIds, truncated: truncatedNodes } = collectNeighborhood(
      [rootId],
      depth,
      direction,
      types,
      includeAi,
      publicationStatus,
    );
    const idList = Array.from(nodeIds);
    const { edges, truncated: truncatedEdges } = fetchEdgesAmong(idList, types, includeAi);

    const response: GraphResponse = {
      root_id: rootId,
      nodes: fetchGraphNodes(idList),
      edges,
      truncated: truncatedNodes || truncatedEdges,
    };
    res.json(response);
  }),
);

export default router;
