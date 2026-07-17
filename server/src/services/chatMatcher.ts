// Chat → work matching. Two lanes, both landing as 'suggested' chat_links that only
// the uploader can promote (§4.1–4.2 trust pattern applied to conversations):
//   1. Identifier lane — DOIs / arXiv ids literally present in the transcript resolve
//      directly against the works table (deterministic, high confidence).
//   2. AI lane — FTS-selected candidate works are handed to the configured AiProvider
//      (heuristic TF-IDF or Anthropic) to judge which ones the conversation discusses.

import { db } from '../db.js';
import { getAiProvider, getAiProviderName, MODEL_INFO } from './aiProvider.js';
import { toSummary } from './workStore.js';
import type { Work, WorkSummary } from '../../../shared/types.js';

/** Cap on transcript text forwarded to the AI provider — never the raw upload. */
export const EXCERPT_CHARS = 20_000;
const MAX_CANDIDATES = 20;
const IDENTIFIER_CONFIDENCE = 0.97;
const IDENTIFIER_MODEL = { model: 'identifier-extractor', model_version: '1.0' };

export interface ChatSuggestion {
  work_id: number;
  confidence: number;
  basis: string;
  model: string;
  model_version: string;
}

// DOI: "10.<registrant>/<suffix>". Trailing sentence punctuation is stripped afterwards.
const DOI_RE = /\b10\.\d{4,9}\/[^\s"'<>()[\]]+/g;
// arXiv new-style ids, either "arXiv:2301.12345" or an arxiv.org URL.
const ARXIV_PREFIX_RE = /\barxiv[:\s/]+(\d{4}\.\d{4,5})(?:v\d+)?\b/gi;
const ARXIV_URL_RE = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/gi;

function extractDois(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(DOI_RE)) {
    out.add(m[0].replace(/[.,;:!?]+$/, ''));
  }
  return Array.from(out);
}

function extractArxivIds(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(ARXIV_PREFIX_RE)) out.add(m[1]);
  for (const m of text.matchAll(ARXIV_URL_RE)) out.add(m[1]);
  return Array.from(out);
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'what', 'how', 'why',
  'at', 'by', 'for', 'with', 'about', 'into', 'through', 'to', 'from', 'in', 'out', 'on', 'of',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'it', 'its', 'this', 'that', 'these', 'those', 'as', 'which', 'who', 'we', 'our', 'you', 'your',
  'i', 'me', 'my', 'they', 'their', 'can', 'could', 'would', 'should', 'will', 'not', 'no', 'so',
  'there', 'here', 'also', 'just', 'like', 'more', 'some', 'any', 'all', 'one', 'two', 'than',
]);

/** Top distinct content terms of the transcript, for seeding the FTS candidate query. */
function topTerms(text: string, n: number): string[] {
  const freq = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/\W+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    freq.set(raw, (freq.get(raw) ?? 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([term]) => term);
}

function ftsCandidates(transcript: string, excludeIds: Set<number>): WorkSummary[] {
  const terms = topTerms(transcript, 12);
  if (terms.length === 0) return [];
  const ftsQuery = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
  let rows: Work[];
  try {
    rows = db
      .prepare(
        `SELECT works.* FROM works_fts JOIN works ON works.id = works_fts.rowid
         WHERE works_fts MATCH ? ORDER BY bm25(works_fts) ASC LIMIT ?`,
      )
      .all(ftsQuery, MAX_CANDIDATES + excludeIds.size) as Work[];
  } catch {
    // Defensive: a pathological transcript should degrade to "no candidates", not a 500.
    rows = [];
  }
  return rows.filter((w) => !excludeIds.has(w.id)).slice(0, MAX_CANDIDATES).map(toSummary);
}

/** Runs both lanes over a transcript. Identifier matches win on overlap. */
export async function matchChatToWorks(transcript: string): Promise<ChatSuggestion[]> {
  const suggestions: ChatSuggestion[] = [];
  const matchedIds = new Set<number>();

  const dois = extractDois(transcript);
  const arxivIds = extractArxivIds(transcript);

  if (dois.length > 0) {
    const rows = db
      .prepare(`SELECT id, doi FROM works WHERE doi IN (${dois.map(() => '?').join(',')})`)
      .all(...dois) as { id: number; doi: string }[];
    for (const row of rows) {
      matchedIds.add(row.id);
      suggestions.push({
        work_id: row.id,
        confidence: IDENTIFIER_CONFIDENCE,
        basis: `DOI ${row.doi} appears in the conversation`,
        ...IDENTIFIER_MODEL,
      });
    }
  }
  if (arxivIds.length > 0) {
    const rows = db
      .prepare(`SELECT id, arxiv_id FROM works WHERE arxiv_id IN (${arxivIds.map(() => '?').join(',')})`)
      .all(...arxivIds) as { id: number; arxiv_id: string }[];
    for (const row of rows) {
      if (matchedIds.has(row.id)) continue;
      matchedIds.add(row.id);
      suggestions.push({
        work_id: row.id,
        confidence: IDENTIFIER_CONFIDENCE,
        basis: `arXiv:${row.arxiv_id} appears in the conversation`,
        ...IDENTIFIER_MODEL,
      });
    }
  }

  const candidates = ftsCandidates(transcript, matchedIds);
  if (candidates.length > 0) {
    const excerpt = transcript.slice(0, EXCERPT_CHARS);
    const provider = getAiProvider();
    const info = MODEL_INFO[getAiProviderName()];
    const matches = await provider.matchChat(excerpt, candidates);
    for (const m of matches) {
      if (matchedIds.has(m.work_id)) continue;
      matchedIds.add(m.work_id);
      suggestions.push({ ...m, model: info.model, model_version: info.model_version });
    }
  }

  return suggestions;
}
