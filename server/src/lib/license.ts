import type { License, Tier } from '../../../shared/types.js';
import { licenseToTier } from '../../../shared/types.js';

export { licenseToTier };

/** §3.2: sub-unit decomposition requires Tier C. */
export function canDecompose(tier: Tier): boolean {
  return tier === 'C';
}

/** §3.1: full text may be stored for Tier B (whole, unmodified) and Tier C. Tier A = metadata + abstract only. */
export function canStoreFullText(tier: Tier): boolean {
  return tier === 'B' || tier === 'C';
}

/** §3.2/§4.3: AI derivative generation over full text requires Tier C. (Tier A/B: metadata+abstract only.) */
export function canAiTransform(tier: Tier): boolean {
  return tier === 'C';
}

const LICENSE_VALUES: License[] = [
  'cc-by', 'cc-by-sa', 'cc0', 'public-domain', 'platform-cc-by-sa',
  'cc-by-nd', 'arxiv-default', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nc-nd',
  'closed', 'unknown',
];

export function isLicense(value: string): value is License {
  return (LICENSE_VALUES as string[]).includes(value);
}

/**
 * Normalize a license URL or SPDX-ish string (as found in arXiv/OpenAlex/Crossref metadata)
 * to our License enum. Unknown → 'unknown' (Tier A — the safe default).
 */
export function normalizeLicense(raw: string | null | undefined): License {
  if (!raw) return 'unknown';
  const s = raw.toLowerCase().trim();
  if (isLicense(s)) return s;
  // URL / SPDX patterns. Order matters: check NC/ND combinations before plain variants.
  if (s.includes('nonexclusive-distrib') || s.includes('non-exclusive')) return 'arxiv-default';
  if (s.includes('publicdomain') || s.includes('public-domain') || s === 'pd') return 'public-domain';
  if (s.includes('zero') || s.includes('cc0')) return 'cc0';
  if (s.includes('by-nc-nd') || s.includes('by_nc_nd') || s.includes('nc-nd')) return 'cc-by-nc-nd';
  if (s.includes('by-nc-sa') || s.includes('by_nc_sa') || s.includes('nc-sa')) return 'cc-by-nc-sa';
  if (s.includes('by-nc') || s.includes('by_nc')) return 'cc-by-nc';
  if (s.includes('by-nd') || s.includes('by_nd')) return 'cc-by-nd';
  if (s.includes('by-sa') || s.includes('by_sa')) return 'cc-by-sa';
  if (s.includes('creativecommons.org/licenses/by/') || s === 'cc-by' || s.includes('cc-by')) return 'cc-by';
  if (s.includes('closed') || s.includes('proprietary') || s.includes('all rights reserved')) return 'closed';
  return 'unknown';
}
