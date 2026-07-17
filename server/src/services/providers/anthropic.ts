// Anthropic-backed AI provider. Spec §7.2.
//
// Real network calls, strict-JSON prompts, defensive parsing — a missing/malformed API
// response degrades to an empty array / fallback text, it never throws up to the route
// (the AI trust boundary must never turn an upstream hiccup into a 500).

import type { AiProvider, ChatMatch, SuggestedEdge } from '../aiProvider.js';
import { EDGE_TYPES } from '../../../../shared/types.js';
import type { EdgeType, GlossaryEntry, WorkDetail, WorkSummary } from '../../../../shared/types.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-5';

const FALLBACK_SUMMARY = 'Summary unavailable — the AI provider returned an unparseable response.';
const FALLBACK_EXPLAIN =
  'Unable to answer this question right now — the AI provider returned an unparseable response.';

interface AnthropicContentBlock {
  type: string;
  text?: string;
}
interface AnthropicMessagesResponse {
  content?: AnthropicContentBlock[];
}

async function callAnthropic(system: string, prompt: string, maxTokens: 1024 | 2048): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // Defense in depth: aiProvider.ts already fails fast at module load if this is missing
  // when AI_PROVIDER=anthropic, so this branch should be unreachable in practice.
  if (!apiKey) return null;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AnthropicMessagesResponse;
    const text = data.content?.find((b) => b.type === 'text')?.text;
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

/** Strip ```json fences if the model wrapped its output despite instructions not to. */
function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fence ? fence[1] : trimmed;
}

function scopedContent(
  work: WorkDetail,
  scope: 'abstract' | 'full',
): { title: string; abstract: string; sections: string | null } {
  const title = work.title;
  const abstract = work.current_version?.content.abstract ?? work.abstract ?? '';
  if (scope !== 'full') return { title, abstract, sections: null };
  const sections = work.current_version?.content.sections ?? [];
  const text = sections.map((s) => `## ${s.heading}\n${s.body}`).join('\n\n');
  return { title, abstract, sections: text || null };
}

export class AnthropicProvider implements AiProvider {
  async suggestEdges(work: WorkDetail, candidates: WorkSummary[]): Promise<SuggestedEdge[]> {
    // §5 enforcement: suggest-edges always uses {title, abstract} only, regardless of tier.
    const list = candidates.slice(0, 20);
    if (list.length === 0) return [];

    const candidateLines = list
      .map((c, i) => `${i}. (work id ${c.id}) ${c.title}\n   Abstract: ${c.abstract ?? '(none)'}`)
      .join('\n');
    const prompt =
      `Analyzed work:\nTitle: ${work.title}\nAbstract: ${work.abstract ?? '(none)'}\n\n` +
      `Candidate works:\n${candidateLines}\n\n` +
      `Identify which candidates plausibly relate to the analyzed work and how.`;
    const system =
      'You are a research-graph edge classifier. Respond with ONLY a strict JSON array (no prose, no ' +
      `markdown fences). Each element: {"candidate_index": <0-based index into the candidate list>, "type": ` +
      `<one of ${JSON.stringify(EDGE_TYPES)}>, "confidence": <number 0..1>, "basis": <short string>}. Only ` +
      'include candidates with a genuine relationship. If none, respond with [].';

    const raw = await callAnthropic(system, prompt, 1024);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(extractJsonText(raw));
      if (!Array.isArray(parsed)) return [];
      const out: SuggestedEdge[] = [];
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue;
        const rec = item as Record<string, unknown>;
        const idx = rec.candidate_index;
        const type = rec.type;
        const confidence = rec.confidence;
        const basis = rec.basis;
        if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= list.length) continue;
        if (typeof type !== 'string' || !(EDGE_TYPES as string[]).includes(type)) continue;
        if (typeof confidence !== 'number' || Number.isNaN(confidence)) continue;
        out.push({
          target_work_id: list[idx].id,
          type: type as EdgeType,
          confidence: Math.max(0, Math.min(1, confidence)),
          basis: typeof basis === 'string' && basis.trim() ? basis.trim() : 'Anthropic-suggested relationship',
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  async matchChat(transcriptExcerpt: string, candidates: WorkSummary[]): Promise<ChatMatch[]> {
    const list = candidates.slice(0, 20);
    if (list.length === 0) return [];

    const candidateLines = list
      .map((c, i) => `${i}. (work id ${c.id}) ${c.title}\n   Abstract: ${c.abstract ?? '(none)'}`)
      .join('\n');
    const prompt =
      `Conversation transcript (may be truncated):\n${transcriptExcerpt}\n\n` +
      `Candidate research works:\n${candidateLines}\n\n` +
      `Identify which candidate works this conversation substantively discusses, builds on, or asks about.`;
    const system =
      'You match an AI-chat transcript to research works it discusses. Respond with ONLY a strict JSON array ' +
      '(no prose, no markdown fences). Each element: {"candidate_index": <0-based index into the candidate ' +
      'list>, "confidence": <number 0..1>, "basis": <short string quoting or paraphrasing where the ' +
      'conversation touches this work>}. Only include works the conversation genuinely engages with — a ' +
      'passing keyword overlap is not enough. If none, respond with [].';

    const raw = await callAnthropic(system, prompt, 1024);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(extractJsonText(raw));
      if (!Array.isArray(parsed)) return [];
      const out: ChatMatch[] = [];
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue;
        const rec = item as Record<string, unknown>;
        const idx = rec.candidate_index;
        const confidence = rec.confidence;
        const basis = rec.basis;
        if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= list.length) continue;
        if (typeof confidence !== 'number' || Number.isNaN(confidence)) continue;
        out.push({
          work_id: list[idx].id,
          confidence: Math.max(0, Math.min(1, confidence)),
          basis: typeof basis === 'string' && basis.trim() ? basis.trim() : 'Anthropic-matched conversation topic',
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  async summarize(work: WorkDetail, scope: 'abstract' | 'full'): Promise<string> {
    const content = scopedContent(work, scope);
    const system =
      'You summarize academic works for a general research audience. Respond with ONLY strict JSON: ' +
      '{"summary": <string>}. No markdown, no extra keys, no prose outside the JSON.';
    const prompt =
      `Title: ${content.title}\nAbstract: ${content.abstract}` +
      (content.sections ? `\nSections:\n${content.sections}` : '') +
      '\n\nWrite a concise, accurate 3-6 sentence summary.';

    const raw = await callAnthropic(system, prompt, scope === 'full' ? 2048 : 1024);
    if (!raw) return FALLBACK_SUMMARY;
    try {
      const parsed = JSON.parse(extractJsonText(raw)) as { summary?: unknown };
      return typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : FALLBACK_SUMMARY;
    } catch {
      return FALLBACK_SUMMARY;
    }
  }

  async glossary(work: WorkDetail, scope: 'abstract' | 'full'): Promise<GlossaryEntry[]> {
    const content = scopedContent(work, scope);
    const system =
      'You extract and define technical terms from academic works. Respond with ONLY strict JSON: ' +
      '{"terms": [{"term": <string>, "definition": <string>}]}, at most 12 entries. No markdown, no extra keys.';
    const prompt =
      `Title: ${content.title}\nAbstract: ${content.abstract}` +
      (content.sections ? `\nSections:\n${content.sections}` : '') +
      '\n\nList the key technical terms with brief, accurate definitions.';

    const raw = await callAnthropic(system, prompt, scope === 'full' ? 2048 : 1024);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(extractJsonText(raw)) as { terms?: unknown };
      if (!Array.isArray(parsed.terms)) return [];
      const out: GlossaryEntry[] = [];
      for (const item of parsed.terms) {
        if (typeof item !== 'object' || item === null) continue;
        const rec = item as Record<string, unknown>;
        if (
          typeof rec.term === 'string' &&
          rec.term.trim() &&
          typeof rec.definition === 'string' &&
          rec.definition.trim()
        ) {
          out.push({ term: rec.term.trim(), definition: rec.definition.trim() });
        }
        if (out.length >= 12) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  async explain(
    work: WorkDetail,
    scope: 'abstract' | 'full',
    question: string,
    subunitId?: number | null,
  ): Promise<string> {
    const content = scopedContent(work, scope);
    const subunit = subunitId != null ? work.subunits.find((s) => s.id === subunitId) : undefined;
    const system =
      'You answer reader questions about an academic work, grounded only in the provided content. Respond ' +
      'with ONLY strict JSON: {"answer": <string>}. If the content does not contain the answer, say so ' +
      'honestly within the answer string. No markdown, no extra keys.';
    const prompt =
      `Title: ${content.title}\nAbstract: ${content.abstract}` +
      (content.sections ? `\nSections:\n${content.sections}` : '') +
      (subunit ? `\nFocused sub-unit (${subunit.type}): ${subunit.content}` : '') +
      `\n\nReader question: ${question}`;

    const raw = await callAnthropic(system, prompt, 1024);
    if (!raw) return FALLBACK_EXPLAIN;
    try {
      const parsed = JSON.parse(extractJsonText(raw)) as { answer?: unknown };
      return typeof parsed.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : FALLBACK_EXPLAIN;
    } catch {
      return FALLBACK_EXPLAIN;
    }
  }
}
