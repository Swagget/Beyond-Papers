import { Router } from 'express';
import { wrapAsync, validationError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { isLicense } from '../lib/license.js';
import { importDoi } from '../services/importers/crossref.js';
import { importArxiv } from '../services/importers/arxiv.js';
import { importOpenalexWork, importOpenalexBatch, importOpenalexWithConnections } from '../services/importers/openalex.js';
import { previewUrl, createWebWork } from '../services/importers/web.js';
import { PUBLICATION_STATUSES, type PublicationStatus } from '../../../shared/types.js';

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

router.post(
  '/url/preview',
  requireAuth,
  wrapAsync(async (req, res) => {
    const url = req.body?.url;
    if (typeof url !== 'string' || !url.trim()) {
      throw validationError('url is required');
    }
    const result = await previewUrl(url.trim());
    res.status(200).json(result);
  }),
);

router.post(
  '/url',
  requireAuth,
  wrapAsync(async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.url !== 'string' || !body.url.trim()) {
      throw validationError('url is required');
    }
    if (typeof body.title !== 'string' || !body.title.trim()) {
      throw validationError('title is required');
    }
    const license = body.license === undefined ? 'unknown' : body.license;
    if (typeof license !== 'string' || !isLicense(license)) {
      throw validationError('license must be a valid license id');
    }
    const status: PublicationStatus = body.publication_status === undefined ? 'informal' : body.publication_status;
    if (!PUBLICATION_STATUSES.includes(status)) {
      throw validationError(`publication_status must be one of: ${PUBLICATION_STATUSES.join(', ')}`);
    }
    const authors = body.authors === undefined ? [] : body.authors;
    if (!Array.isArray(authors) || authors.some((a: unknown) => typeof a !== 'string' || !(a as string).trim())) {
      throw validationError('authors must be an array of non-empty strings');
    }
    let year: number | null = null;
    if (body.publication_year !== undefined && body.publication_year !== null && body.publication_year !== '') {
      year = Number(body.publication_year);
      if (!Number.isInteger(year) || year < 1500 || year > 2100) {
        throw validationError('publication_year must be a plausible year');
      }
    }

    const result = createWebWork({
      url: body.url.trim(),
      title: body.title.trim(),
      authors: (authors as string[]).map((a) => a.trim()),
      publication_year: year,
      site_name: typeof body.site_name === 'string' && body.site_name.trim() ? body.site_name.trim() : null,
      abstract: typeof body.abstract === 'string' && body.abstract.trim() ? body.abstract.trim() : null,
      license,
      publication_status: status,
      doi: typeof body.doi === 'string' && body.doi.trim() ? body.doi.trim() : null,
      arxiv_id: typeof body.arxiv_id === 'string' && body.arxiv_id.trim() ? body.arxiv_id.trim() : null,
    });
    res.status(result.created ? 201 : 200).json(result);
  }),
);

export default router;
