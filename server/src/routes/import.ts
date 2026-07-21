import { Router } from 'express';
import { wrapAsync, validationError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { importDoi } from '../services/importers/crossref.js';
import { importArxiv } from '../services/importers/arxiv.js';
import { importOpenalexWork, importOpenalexBatch, importOpenalexWithConnections } from '../services/importers/openalex.js';

// Mounted at /api/import (index.ts). All routes require auth (spec §13.9).
const router = Router();

router.post(
  '/doi',
  requireAuth,
  wrapAsync(async (req, res) => {
    const doi = req.body?.doi;
    if (typeof doi !== 'string' || !doi.trim()) {
      throw validationError('doi is required');
    }
    const result = await importDoi(doi.trim());
    res.status(result.created ? 201 : 200).json(result);
  }),
);

router.post(
  '/arxiv',
  requireAuth,
  wrapAsync(async (req, res) => {
    const arxivId = req.body?.arxiv_id;
    if (typeof arxivId !== 'string' || !arxivId.trim()) {
      throw validationError('arxiv_id is required');
    }
    const result = await importArxiv(arxivId.trim());
    res.status(result.created ? 201 : 200).json(result);
  }),
);

router.post(
  '/openalex',
  requireAuth,
  wrapAsync(async (req, res) => {
    const { openalex_id: openalexId, query, limit, with_connections: withConnections } = req.body ?? {};
    const hasId = typeof openalexId === 'string' && openalexId.trim().length > 0;
    const hasQuery = typeof query === 'string' && query.trim().length > 0;

    if (hasId === hasQuery) {
      // Neither or both supplied — spec §13.9: 400 if neither openalex_id nor query given
      // (and the two modes are mutually exclusive).
      throw validationError('Provide exactly one of openalex_id or query');
    }
    if (withConnections !== undefined && typeof withConnections !== 'boolean') {
      throw validationError('with_connections must be a boolean');
    }
    if (withConnections && !hasId) {
      throw validationError('with_connections requires openalex_id');
    }

    if (hasId) {
      const result = withConnections
        ? await importOpenalexWithConnections(openalexId.trim(), req.user!.id)
        : await importOpenalexWork(openalexId.trim());
      res.status(result.created ? 201 : 200).json(result);
      return;
    }

    const limitNum = limit === undefined ? 20 : Number(limit);
    if (!Number.isFinite(limitNum) || limitNum < 1 || limitNum > 50) {
      throw validationError('limit must be a number between 1 and 50');
    }
    const items = await importOpenalexBatch(query.trim(), limitNum);
    res.status(200).json({ items });
  }),
);

export default router;
