// Web/blog importer — fetches a user-supplied URL politely and extracts best-effort
// metadata for review before saving (two-step: previewUrl → createWebWork).
// Politeness contract: one fetch per preview, robots.txt respected, 401/403/429 are
// honored as "blocked" (never retried or circumvented), 15s timeout, ~2MB body cap.
// Extraction is regex-based over the document head (+ a bounded body prefix for
// JSON-LD / CC license links) — no HTML-parser dependency, same convention as arxiv.ts.

import { validationError } from '../../lib/errors.js';
import { normalizeLicense } from '../../lib/license.js';
import { createWork, getWorkDetail, type AuthorshipInput } from '../workStore.js';
import { findExisting, normalizeArxivId, normalizeDoi, normalizeUrl, resolveAuthorId } from '../dedup.js';
import type {
  ImportResult,
  LicenseId,
  PublicationStatus,
  UrlPreviewExtracted,
  UrlPreviewResponse,
} from '../../../../shared/types.js';

const USER_AGENT = 'BeyondPapers/0.1 (research-graph; mailto:admin@example.org)';
const FETCH_TIMEOUT_MS = 15000;
const ROBOTS_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** How far into the document we scan for JSON-LD blocks and CC license links. */
const SCAN_PREFIX_BYTES = 512 * 1024;

// ---------- URL validation (SSRF guard) ----------

const PRIVATE_HOST_RE = /^(localhost|.*\.local|.*\.internal)$/i;

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** Reject anything that is not a public http(s) URL. The server fetches user-supplied
 *  URLs, so this must run on the input URL and again on every redirect target. */
function assertPublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw validationError('url must be a valid absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw validationError('url must use http or https');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (PRIVATE_HOST_RE.test(host) || isPrivateIpv4(host) || host === '::1' || host.startsWith('fd') || host.startsWith('fe80')) {
    throw validationError('url must point to a public host');
  }
  return parsed;
}

// ---------- robots.txt ----------

/** Minimal robots.txt check: parse `User-agent: *` groups' Disallow prefix rules.
 *  Unreachable/malformed robots.txt ⇒ allowed (standard permissive interpretation). */
async function robotsAllows(target: URL): Promise<boolean> {
  let text: string;
  try {
    const res = await fetch(`${target.protocol}//${target.host}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) return true;
    text = await res.text();
  } catch {
    return true;
  }

  let inStarGroup = false;
  const disallowed: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      inStarGroup = value === '*';
    } else if (field === 'disallow' && inStarGroup && value) {
      disallowed.push(value);
    }
  }
  const pathAndQuery = target.pathname + target.search;
  return !disallowed.some((prefix) => pathAndQuery.startsWith(prefix));
}

// ---------- fetch ----------

interface PageFetch {
  status: 'ok' | 'blocked' | 'error';
  finalUrl: string;
  html: string | null;
  message?: string;
}

async function fetchPage(target: URL): Promise<PageFetch> {
  let res: Response;
  try {
    res = await fetch(target.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch (err) {
    return { status: 'error', finalUrl: target.toString(), html: null, message: `Fetch failed: ${(err as Error).message}` };
  }

  const finalUrl = res.url || target.toString();
  // Redirect target must also be public (fetch followed it already; refuse to use the body if private).
  try {
    assertPublicHttpUrl(finalUrl);
  } catch {
    return { status: 'error', finalUrl: target.toString(), html: null, message: 'URL redirected to a non-public host' };
  }

  if (res.status === 401 || res.status === 403 || res.status === 429) {
    return { status: 'blocked', finalUrl, html: null, message: `Site declined automated access (HTTP ${res.status})` };
  }
  if (!res.ok) {
    return { status: 'error', finalUrl, html: null, message: `Site returned HTTP ${res.status}` };
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('html')) {
    return { status: 'error', finalUrl, html: null, message: `Not an HTML page (content-type: ${contentType || 'unknown'})` };
  }

  // Stream with a hard byte cap — no retry, no second request.
  const reader = res.body?.getReader();
  if (!reader) return { status: 'error', finalUrl, html: null, message: 'Empty response body' };
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
  }
  void reader.cancel().catch(() => {});
  const html = Buffer.concat(chunks).toString('utf8');
  return { status: 'ok', finalUrl, html };
}

// ---------- extraction ----------

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** All <meta> tags whose name/property matches, in document order (attribute order-agnostic). */
function metaContents(html: string, nameOrProperty: string): string[] {
  const out: string[] = [];
  const tagRe = /<meta\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const attrs = m[1];
    const keyMatch = /(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!keyMatch || keyMatch[1].toLowerCase() !== nameOrProperty.toLowerCase()) continue;
    const contentMatch = /content\s*=\s*["']([^"']*)["']/i.exec(attrs);
    if (contentMatch && contentMatch[1].trim()) out.push(decodeEntities(contentMatch[1]));
  }
  return out;
}

function firstMeta(html: string, ...names: string[]): string | null {
  for (const name of names) {
    const hits = metaContents(html, name);
    if (hits.length > 0) return hits[0];
  }
  return null;
}

function yearFrom(dateish: string | null): number | null {
  if (!dateish) return null;
  const m = /(\d{4})/.exec(dateish);
  if (!m) return null;
  const year = Number(m[1]);
  return year >= 1500 && year <= 2100 ? year : null;
}

interface JsonLdArticle {
  headline?: string;
  author?: unknown;
  datePublished?: string;
  publisher?: { name?: string } | string;
  description?: string;
}

/** First Article-like JSON-LD block, if any. Guarded parse; @graph arrays flattened. */
function extractJsonLd(html: string): JsonLdArticle | null {
  const ARTICLE_TYPES = new Set(['Article', 'BlogPosting', 'ScholarlyArticle', 'NewsArticle', 'TechArticle']);
  const scriptRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]) as unknown;
      const candidates: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { '@graph'?: unknown[] })['@graph'])
          ? (parsed as { '@graph': unknown[] })['@graph']
          : [parsed];
      for (const c of candidates) {
        if (!c || typeof c !== 'object') continue;
        const type = (c as { '@type'?: string | string[] })['@type'];
        const types = Array.isArray(type) ? type : type ? [type] : [];
        if (types.some((t) => ARTICLE_TYPES.has(t))) return c as JsonLdArticle;
      }
    } catch {
      // malformed JSON-LD — ignore this block
    }
  }
  return null;
}

function jsonLdAuthors(author: unknown): string[] {
  const list = Array.isArray(author) ? author : author ? [author] : [];
  const names: string[] = [];
  for (const a of list) {
    if (typeof a === 'string') names.push(a.trim());
    else if (a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string') {
      names.push(((a as { name: string }).name).trim());
    }
  }
  return names.filter(Boolean);
}

/** Best-effort metadata extraction. Priority per field: citation_* meta > JSON-LD > OpenGraph > fallbacks. */
export function extractMetadata(html: string, finalUrl: string): UrlPreviewExtracted {
  const head = html.slice(0, SCAN_PREFIX_BYTES);
  const jsonLd = extractJsonLd(head);

  const title =
    firstMeta(head, 'citation_title') ??
    (jsonLd?.headline?.trim() || null) ??
    firstMeta(head, 'og:title') ??
    (() => {
      const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
      return t ? decodeEntities(t[1].replace(/\s+/g, ' ')) : null;
    })();

  const citationAuthors = metaContents(head, 'citation_author');
  const authors =
    citationAuthors.length > 0
      ? citationAuthors
      : jsonLd
        ? jsonLdAuthors(jsonLd.author)
        : (firstMeta(head, 'article:author', 'author')?.split(/,|\band\b/).map((s) => s.trim()).filter(Boolean) ?? []);

  const publication_year =
    yearFrom(firstMeta(head, 'citation_publication_date', 'citation_date', 'citation_online_date')) ??
    yearFrom(jsonLd?.datePublished ?? null) ??
    yearFrom(firstMeta(head, 'article:published_time'));

  const publisherName =
    typeof jsonLd?.publisher === 'string' ? jsonLd.publisher : jsonLd?.publisher?.name;
  const site_name =
    firstMeta(head, 'og:site_name') ??
    (publisherName?.trim() || null) ??
    (() => {
      try {
        return new URL(finalUrl).hostname.replace(/^www\./, '');
      } catch {
        return null;
      }
    })();

  const abstract =
    firstMeta(head, 'citation_abstract') ??
    firstMeta(head, 'og:description') ??
    (jsonLd?.description?.trim() || null) ??
    firstMeta(head, 'description');

  // CC / public-domain license links anywhere in the scanned prefix.
  const ccMatch = /https?:\/\/creativecommons\.org\/(licenses|publicdomain)\/[^\s"'<>]+/i.exec(head);
  const license: LicenseId = ccMatch ? normalizeLicense(ccMatch[0]) : 'unknown';

  const rawDoi = firstMeta(head, 'citation_doi');
  const rawArxiv = firstMeta(head, 'citation_arxiv_id');

  return {
    title,
    authors,
    publication_year,
    site_name,
    abstract,
    license,
    doi: rawDoi ? normalizeDoi(rawDoi) : null,
    arxiv_id: rawArxiv ? normalizeArxivId(rawArxiv) : null,
  };
}

// ---------- public API ----------

/** Step 1: fetch + extract, no DB write. 'blocked'/'error' are successful responses
 *  that put the client into manual-entry mode — never thrown. */
export async function previewUrl(rawUrl: string): Promise<UrlPreviewResponse> {
  const target = assertPublicHttpUrl(rawUrl);
  const inputNormalized = normalizeUrl(target.toString());
  if (!inputNormalized) throw validationError('url must be a valid http(s) URL');

  if (!(await robotsAllows(target))) {
    return {
      fetch_status: 'blocked',
      url: target.toString(),
      normalized_url: inputNormalized,
      existing_work_id: findExisting({ url_normalized: inputNormalized })?.id ?? null,
      extracted: null,
      message: 'The site\'s robots.txt disallows automated access to this page',
    };
  }

  const page = await fetchPage(target);
  const normalized = normalizeUrl(page.finalUrl) ?? inputNormalized;
  const extracted = page.status === 'ok' && page.html ? extractMetadata(page.html, page.finalUrl) : null;

  const existing =
    findExisting({
      url_normalized: normalized,
      doi: extracted?.doi ?? null,
      arxiv_id: extracted?.arxiv_id ?? null,
    }) ?? (normalized !== inputNormalized ? findExisting({ url_normalized: inputNormalized }) : undefined);

  return {
    fetch_status: page.status,
    url: page.finalUrl,
    normalized_url: normalized,
    existing_work_id: existing?.id ?? null,
    extracted,
    ...(page.message ? { message: page.message } : {}),
  };
}

export interface CreateWebWorkInput {
  url: string;
  title: string;
  authors?: string[];
  publication_year?: number | null;
  site_name?: string | null;
  abstract?: string | null;
  license: LicenseId;
  publication_status: PublicationStatus;
  doi?: string | null;
  arxiv_id?: string | null;
}

/** Step 2: create the blog work from user-reviewed fields. No fetch happens here.
 *  Regardless of detected license, v1 stores metadata + abstract only (sections: [])
 *  and links out — full-text capture for CC pages is a deliberate follow-up. */
export function createWebWork(input: CreateWebWorkInput): ImportResult {
  const target = assertPublicHttpUrl(input.url);
  const normalized = normalizeUrl(target.toString());
  if (!normalized) throw validationError('url must be a valid http(s) URL');

  const existing = findExisting({
    url_normalized: normalized,
    doi: input.doi ?? null,
    arxiv_id: input.arxiv_id ?? null,
    title: input.title,
  });
  if (existing) {
    return { work: getWorkDetail(existing.id)!, created: false };
  }

  const authors: AuthorshipInput[] = (input.authors ?? []).map((name, i) => ({
    position: i + 1,
    author_id: resolveAuthorId({ full_name: name }),
    credit_roles: [],
  }));

  const work = createWork({
    kind: 'blog',
    source: 'web',
    created_by: null,
    title: input.title,
    abstract: input.abstract ?? null,
    sections: [],
    references: [],
    license: input.license,
    doi: input.doi ?? null,
    arxiv_id: input.arxiv_id ?? null,
    url: target.toString(),
    url_normalized: normalized,
    site_name: input.site_name ?? null,
    publication_status: input.publication_status,
    publication_year: input.publication_year ?? null,
    authors,
    change_note: 'Imported from URL',
  });

  return { work, created: true };
}
