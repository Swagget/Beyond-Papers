import { createHash } from 'node:crypto';

/** Deterministic JSON stringify: object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** sha256 hex of the canonical JSON of a value (§1.3 content addressing). */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** sha256 hex of a plain string (for sub-unit content). */
export function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
