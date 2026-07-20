// Per-user AI credential storage. The plaintext API key lives only transiently:
// it is sealed by lib/crypto (AES-256-GCM) before it touches the DB, and decrypted
// on demand when the user's own provider is constructed (getAiProviderForUser).
//
// Nothing here ever logs or returns the raw key except getUserApiKey(), which exists
// solely so the AI layer can authenticate as the user. Routes expose only getStatus().

import { db } from '../db.js';
import { encryptSecret, decryptSecret, type Sealed } from '../lib/crypto.js';
import type { AiCredentialStatus } from '../../../shared/types.js';

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
const ANTHROPIC_VERSION = '2023-06-01';

interface CredRow {
  user_id: number;
  provider: 'anthropic';
  ciphertext: string;
  iv: string;
  auth_tag: string;
  last4: string;
  status: 'valid' | 'invalid' | 'unvalidated';
  validated_at: string | null;
}

function last4Of(key: string): string {
  return key.slice(-4);
}

/** Live-checks a key against Anthropic's models endpoint (no token cost). */
export async function validateAnthropicKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(ANTHROPIC_MODELS_URL, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Encrypts and upserts the user's key. Caller has already validated `status`. */
export function setUserCredential(
  userId: number,
  provider: 'anthropic',
  apiKey: string,
  status: 'valid' | 'invalid' | 'unvalidated',
): void {
  const sealed: Sealed = encryptSecret(apiKey);
  const validatedAt = status === 'valid' ? new Date().toISOString() : null;
  db.prepare(
    `INSERT INTO user_ai_credentials (user_id, provider, ciphertext, iv, auth_tag, last4, status, validated_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(user_id) DO UPDATE SET
       provider     = excluded.provider,
       ciphertext   = excluded.ciphertext,
       iv           = excluded.iv,
       auth_tag     = excluded.auth_tag,
       last4        = excluded.last4,
       status       = excluded.status,
       validated_at = excluded.validated_at,
       updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(userId, provider, sealed.ciphertext, sealed.iv, sealed.auth_tag, last4Of(apiKey), status, validatedAt);
}

export function deleteUserCredential(userId: number): void {
  db.prepare('DELETE FROM user_ai_credentials WHERE user_id = ?').run(userId);
}

/** Public-safe view: never includes the key or ciphertext. Returns absent-state when none stored. */
export function getStatus(userId: number): AiCredentialStatus {
  const row = db
    .prepare('SELECT provider, last4, status, validated_at FROM user_ai_credentials WHERE user_id = ?')
    .get(userId) as Pick<CredRow, 'provider' | 'last4' | 'status' | 'validated_at'> | undefined;
  if (!row) {
    return { provider: 'anthropic', present: false, last4: null, status: 'unvalidated', validated_at: null };
  }
  return {
    provider: row.provider,
    present: true,
    last4: row.last4,
    status: row.status,
    validated_at: row.validated_at,
  };
}

/** Decrypts and returns the user's raw key, or null if none stored. AI layer only. */
export function getUserApiKey(userId: number): string | null {
  const row = db
    .prepare('SELECT ciphertext, iv, auth_tag FROM user_ai_credentials WHERE user_id = ?')
    .get(userId) as Pick<CredRow, 'ciphertext' | 'iv' | 'auth_tag'> | undefined;
  if (!row) return null;
  try {
    return decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, auth_tag: row.auth_tag });
  } catch {
    // Master key rotated or row tampered — treat as no usable credential.
    return null;
  }
}
