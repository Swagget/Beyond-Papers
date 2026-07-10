import { createHash } from 'node:crypto';

/** Deterministic JSON stringify: object keys sorted recursively; array order preserved. */
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

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * §1.3 content addressing.
 * work_versions.content_hash = contentHash({title, abstract, sections, references}) — exactly those four fields.
 * subunits.content_hash      = contentHash({type, title, content}).
 */
export function contentHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
