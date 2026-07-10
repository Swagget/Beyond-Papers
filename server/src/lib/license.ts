import type { LicenseId, Tier } from '../../../shared/types.js';
import { licenseToTier, LICENSE_IDS } from '../../../shared/types.js';

export { licenseToTier };

// Three independent gate predicates (spec §5). Never infer permission from
// client-supplied tier — always recompute licenseToTier(license) server-side.

/** §3.1: full content may be stored for Tier B (whole, unchanged) and Tier C. Tier A = metadata + abstract only. */
export function canStoreFullContent(tier: Tier): boolean {
  return tier === 'B' || tier === 'C';
}

/** §3.2: sub-unit decomposition requires Tier C. */
export function canCreateSubunits(tier: Tier): boolean {
  return tier === 'C';
}

/** §3.2/§4.3: AI transformation over full text requires Tier C. (Tier A/B: metadata + abstract only.) */
export function canAiTransformFullText(tier: Tier): boolean {
  return tier === 'C';
}

export function isNc(license: LicenseId): boolean {
  return license === 'cc-by-nc' || license === 'cc-by-nc-sa' || license === 'cc-by-nc-nd';
}

export function isLicense(value: string): value is LicenseId {
  return (LICENSE_IDS as string[]).includes(value);
}

/**
 * Normalize a license URL or SPDX-ish string (as found in arXiv/OpenAlex/Crossref metadata)
 * to our LicenseId enum (spec §10 mapping table). Unknown → 'unknown' (Tier A — the safe default).
 */
export function normalizeLicense(raw: string | null | undefined): LicenseId {
  if (!raw) return 'unknown';
  const s = raw.toLowerCase().trim();
  if (isLicense(s)) return s;
  // URL patterns, matched by path segment; order matters (NC/ND combos before plain variants).
  if (s.includes('nonexclusive-distrib') || s.includes('non-exclusive')) return 'arxiv-default';
  if (s.includes('/publicdomain/zero/')) return 'cc0';
  if (s.includes('/publicdomain/mark/') || s.includes('public-domain') || s.includes('publicdomain')) return 'public-domain';
  if (s.includes('cc0') || s.includes('zero/1.0')) return 'cc0';
  if (s.includes('by-nc-nd') || s.includes('by_nc_nd')) return 'cc-by-nc-nd';
  if (s.includes('by-nc-sa') || s.includes('by_nc_sa')) return 'cc-by-nc-sa';
  if (s.includes('by-nc') || s.includes('by_nc')) return 'cc-by-nc';
  if (s.includes('by-nd') || s.includes('by_nd')) return 'cc-by-nd';
  if (s.includes('by-sa') || s.includes('by_sa')) return 'cc-by-sa';
  if (s.includes('/licenses/by/') || s.includes('cc-by') || s === 'by') return 'cc-by';
  if (s.includes('closed') || s.includes('proprietary') || s.includes('all rights reserved')) return 'closed';
  return 'unknown';
}
