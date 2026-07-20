// Per-user AI credential management. Mounted at /api/me (all routes require a session).
//
// The stored key is write-only from the client's perspective: PUT accepts it, GET/DELETE
// never return it — only the status view (present?, last4, validation state). On PUT the
// key is live-validated against Anthropic before being sealed and stored, so a typo'd or
// revoked key is caught immediately rather than silently failing on first use.

import { Router } from 'express';
import { wrapAsync, validationError, unauthorized, AppError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { credentialStorageAvailable } from '../lib/crypto.js';
import {
  setUserCredential,
  deleteUserCredential,
  getStatus,
  validateAnthropicKey,
} from '../services/credentialStore.js';

const router = Router();

// Anthropic keys are "sk-ant-..." — cheap shape check before we spend a network round-trip.
const ANTHROPIC_KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

const storageGuard = (): void => {
  if (!credentialStorageAvailable()) {
    throw new AppError(
      503,
      'CREDENTIAL_STORAGE_UNAVAILABLE',
      'Credential storage is not configured on this server (CREDENTIAL_ENC_KEY is unset).',
    );
  }
};

router.get(
  '/ai-credentials',
  requireAuth,
  wrapAsync(async (req, res) => {
    if (!req.user) throw unauthorized();
    res.status(200).json({ credential: getStatus(req.user.id) });
  }),
);

router.put(
  '/ai-credentials',
  requireAuth,
  wrapAsync(async (req, res) => {
    if (!req.user) throw unauthorized();
    storageGuard();

    const body = (req.body ?? {}) as Record<string, unknown>;
    const provider = body.provider ?? 'anthropic';
    const apiKey = body.api_key;

    if (provider !== 'anthropic') {
      throw validationError("provider must be 'anthropic' (only Claude is supported for now)");
    }
    if (typeof apiKey !== 'string' || !ANTHROPIC_KEY_RE.test(apiKey.trim())) {
      throw validationError('api_key must be a valid Anthropic key (starts with "sk-ant-")');
    }

    const key = apiKey.trim();
    const valid = await validateAnthropicKey(key);
    if (!valid) {
      // Reject rather than store an invalid key — clearer for the user than a later silent no-op.
      throw validationError('Anthropic rejected this key. Check that it is active and has API access.');
    }

    setUserCredential(req.user.id, 'anthropic', key, 'valid');
    res.status(200).json({ credential: getStatus(req.user.id) });
  }),
);

router.delete(
  '/ai-credentials',
  requireAuth,
  wrapAsync(async (req, res) => {
    if (!req.user) throw unauthorized();
    deleteUserCredential(req.user.id);
    res.status(204).end();
  }),
);

export default router;
