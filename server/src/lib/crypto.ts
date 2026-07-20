// Symmetric encryption for at-rest secrets (per-user AI API keys).
//
// AES-256-GCM. The master key comes from env CREDENTIAL_ENC_KEY (64 hex chars = 32
// bytes; generate with `openssl rand -hex 32`). Unlike the AI provider's fail-fast at
// boot, this stays lazy: a deploy with no key still boots normally — the credential
// routes just refuse with a clear 503 until the key is provisioned. That keeps the new
// feature from bricking an existing deployment.

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { AppError } from './errors.js';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length

export interface Sealed {
  ciphertext: string; // hex
  iv: string; // hex
  auth_tag: string; // hex
}

let cachedKey: Buffer | null = null;

/** Returns the 32-byte master key, or throws a 503 AppError if unconfigured/malformed. */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.CREDENTIAL_ENC_KEY;
  if (!raw) {
    throw new AppError(
      503,
      'CREDENTIAL_STORAGE_UNAVAILABLE',
      'Credential storage is not configured on this server (CREDENTIAL_ENC_KEY is unset).',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    throw new AppError(
      503,
      'CREDENTIAL_STORAGE_UNAVAILABLE',
      'CREDENTIAL_ENC_KEY must be 64 hex characters (32 bytes). Generate with: openssl rand -hex 32',
    );
  }
  cachedKey = Buffer.from(raw.trim(), 'hex');
  return cachedKey;
}

/** True when a usable master key is present — lets routes 503 early with a clean message. */
export function credentialStorageAvailable(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): Sealed {
  const key = masterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: enc.toString('hex'), iv: iv.toString('hex'), auth_tag: tag.toString('hex') };
}

/** Decrypts a sealed secret. Throws if the master key changed or the record was tampered with. */
export function decryptSecret(sealed: Sealed): string {
  const key = masterKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(sealed.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(sealed.auth_tag, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}
