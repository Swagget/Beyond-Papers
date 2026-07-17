// Deterministic, zero-network AI provider. Spec §7.1.
//
// TF-IDF cosine similarity for edge suggestion, extractive TF-IDF sentence scoring for
// summarization/explanation, regex term extraction for glossary. No external calls, no
// API key required — the app must be fully demoable with zero API keys and zero cost (§7).

import type { AiProvider, ChatMatch, SuggestedEdge } from '../aiProvider.js';
import type { EdgeType, GlossaryEntry, Section, WorkDetail, WorkSummary } from '../../../../shared/types.js';

export const MIN_CONFIDENCE = 0.15;
export const MAX_SUGGESTIONS = 5;
const GLOSSARY_CAP = 12;

const PLACEHOLDER_DEFINITION =
  'Technical term found in this work — no definition available from the heuristic provider.';

// ~50-word built-in stopword list (spec §7.1).
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out',
  'on', 'off', 'over', 'under', 'again', 'further', 'once', 'here', 'there', 'all',
  'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'is',
  'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'doing', 'it', 'its', 'this', 'that', 'these', 'those',
  'as', 'which', 'who', 'whom', 'of', 'we', 'our', 'their', 'they', 'you',
]);

// ---------- tokenization & TF-IDF ----------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** Smoothed IDF over an arbitrary document set ("idf over the candidate set + work" per §7.1;
 * for summarize/explain each sentence of the single work stands in as a pseudo-document so
 * IDF has a corpus to work over at all). */
function computeIdf(docs: string[][]): Map<string, number> {
  const n = docs.length;
  const df = new Map<string, number>();
  for (const tokens of docs) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, count] of df) idf.set(term, Math.log((n + 1) / (count + 1)) + 1);
  return idf;
}

function tfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const vec = new Map<string, number>();
  for (const [term, count] of termFreq(tokens)) vec.set(term, count * (idf.get(term) ?? 0));
  return vec;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [term, weight] of a) {
    const other = b.get(term);
    if (other) dot += weight * other;
  }
  let normA = 0;
  for (const w of a.values()) normA += w * w;
  let normB = 0;
  for (const w of b.values()) normB += w * w;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------- content extraction ----------

function titleAbstractText(title: string, abstract: string | null | undefined): string {
  return `${title} ${abstract ?? ''}`.trim();
}

/**
 * Defense in depth: only ever fold section content in when scope === 'full', even if the
 * WorkDetail happens to carry sections. The route layer (routes/ai.ts) is responsible for
 * physically stripping sections for 'abstract' scope per invariant §15.1 — this is a second,
 * independent line of defense so full text can never reach a downstream call from here either.
 */
function fullText(work: WorkDetail, scope: 'abstract' | 'full'): string {
  const parts = [work.title, work.current_version?.content.abstract ?? work.abstract ?? ''];
  if (scope === 'full') {
    const sections: Section[] = work.current_version?.content.sections ?? [];
    for (const s of sections) parts.push(s.heading, s.body);
  }
  return parts.filter((p) => p && p.trim().length > 0).join('. ');
}

function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const matches = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  return (matches ?? [trimmed]).map((s) => s.trim()).filter(Boolean);
}

/** Extractive summarization: score each sentence by the sum of TF-IDF weights of its terms
 * (IDF computed across the document's own sentences), keep the top N, restore original order. */
function extractiveSummary(text: string, topN: number): string {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return '';
  if (sentences.length <= topN) return sentences.join(' ');

  const tokenized = sentences.map((s) => tokenize(s));
  const idf = computeIdf(tokenized);
  const scores = tokenized.map((tokens) => {
    const tf = termFreq(tokens);
    let score = 0;
    for (const [term, count] of tf) score += count * (idf.get(term) ?? 0);
    return score;
  });

  const ranked = scores
    .map((score, i) => ({ score, i }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .sort((a, b) => a.i - b.i);
  return ranked.map((r) => sentences[r.i]).join(' ');
}

// ---------- glossary term extraction (regexes per spec §7.1) ----------

const PHRASE_RE = /(?:[A-Z][a-z]+ ){1,3}[A-Z][a-z]+/g;
const ACRONYM_RE = /\b[A-Z]{2,}\b/g;
const DIGIT_TOKEN_RE = /\b\w*\d\w*\b/g;

function extractGlossaryTerms(text: string): string[] {
  const terms = new Set<string>();

  for (const m of text.matchAll(PHRASE_RE)) {
    const phrase = m[0].trim();
    const firstWord = phrase.split(/\s+/)[0]?.toLowerCase();
    // Drop common words (title-case sentence starts) — e.g. "The Study" is not a term,
    // just an article capitalized because it opened a sentence.
    if (firstWord && STOPWORDS.has(firstWord)) continue;
    terms.add(phrase);
  }
  for (const m of text.matchAll(ACRONYM_RE)) terms.add(m[0]);
  for (const m of text.matchAll(DIGIT_TOKEN_RE)) {
    const tok = m[0];
    if (/\d/.test(tok)) terms.add(tok);
  }

  return Array.from(terms).slice(0, GLOSSARY_CAP);
}

// ---------- provider ----------

export class HeuristicProvider implements AiProvider {
  async suggestEdges(work: WorkDetail, candidates: WorkSummary[]): Promise<SuggestedEdge[]> {
    const workTokens = tokenize(titleAbstractText(work.title, work.abstract));
    const candidateTokens = candidates.map((c) => tokenize(titleAbstractText(c.title, c.abstract)));
    const idf = computeIdf([workTokens, ...candidateTokens]);
    const workVec = tfidfVector(workTokens, idf);

    const scored = candidates
      .map((c, i) => ({ candidate: c, sim: cosineSimilarity(workVec, tfidfVector(candidateTokens[i], idf)) }))
      .filter((s) => s.sim >= MIN_CONFIDENCE)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, MAX_SUGGESTIONS);

    return scored.map((s) => ({
      target_work_id: s.candidate.id,
      type: 'cites' as EdgeType, // heuristic cannot infer semantic edge types (§7.1)
      confidence: s.sim,
      basis: `TF-IDF cosine similarity: ${s.sim.toFixed(2)}`,
    }));
  }

  async matchChat(transcriptExcerpt: string, candidates: WorkSummary[]): Promise<ChatMatch[]> {
    const chatTokens = tokenize(transcriptExcerpt);
    const candidateTokens = candidates.map((c) => tokenize(titleAbstractText(c.title, c.abstract)));
    const idf = computeIdf([chatTokens, ...candidateTokens]);
    const chatVec = tfidfVector(chatTokens, idf);

    return candidates
      .map((c, i) => ({ candidate: c, sim: cosineSimilarity(chatVec, tfidfVector(candidateTokens[i], idf)) }))
      .filter((s) => s.sim >= MIN_CONFIDENCE)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, MAX_SUGGESTIONS)
      .map((s) => ({
        work_id: s.candidate.id,
        confidence: s.sim,
        basis: `TF-IDF cosine similarity between the conversation and this work: ${s.sim.toFixed(2)}`,
      }));
  }

  async summarize(work: WorkDetail, scope: 'abstract' | 'full'): Promise<string> {
    const text = fullText(work, scope);
    const topN = scope === 'full' ? 5 : 3;
    return extractiveSummary(text, topN);
  }

  async glossary(work: WorkDetail, scope: 'abstract' | 'full'): Promise<GlossaryEntry[]> {
    const text = fullText(work, scope);
    return extractGlossaryTerms(text).map((term) => ({ term, definition: PLACEHOLDER_DEFINITION }));
  }

  async explain(
    work: WorkDetail,
    scope: 'abstract' | 'full',
    question: string,
    subunitId?: number | null,
  ): Promise<string> {
    let source = fullText(work, scope);
    if (subunitId != null) {
      const subunit = work.subunits.find((s) => s.id === subunitId);
      if (subunit) source = `${work.title}. ${subunit.content}`;
    }
    const topN = scope === 'full' ? 5 : 3;
    const summary = extractiveSummary(source, topN) || 'No content is available to summarize for this work.';
    return (
      `The heuristic provider cannot truly understand or answer free-form questions such as ` +
      `"${question}" — it has no language model behind it. Here is an extractive summary of the ` +
      `relevant content instead: ${summary}`
    );
  }
}
