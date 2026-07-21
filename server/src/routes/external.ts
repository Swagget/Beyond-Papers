import { Router } from 'express';
import { wrapAsync, validationError } from '../lib/errors.js';
import { searchOpenalexExternal } from '../services/importers/openalex.js';
import type { ExternalSearchResponse } from '../../../shared/types.js';

// Mounted at /api/external (index.ts). Read-only lookups against external sources —
// public, like /api/search and /api/graph. Nothing here writes to the DB.
const router = Router();

router.get(
  '/search',
  wrapAsync(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) throw validationError('q is required');
    const limitNum = req.query.limit === undefined ? 10 : Number(req.query.limit);
    if (!Number.isFinite(limitNum) || limitNum < 1 || limitNum > 25) {
      throw validationError('limit must be a number between 1 and 25');
    }
    const items = await searchOpenalexExternal(q, limitNum);
    const body: ExternalSearchResponse = { items };
    res.json(body);
  }),
);

export default router;
