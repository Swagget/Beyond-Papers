// AI trust boundary — provider interface + factory. Spec §7 (whole section), §19.1.
//
// This module enforces "fail fast": if AI_PROVIDER=anthropic and ANTHROPIC_API_KEY is
// unset, importing this module throws immediately at server boot (routes/ai.ts imports it,
// index.ts imports routes/ai.ts) — never lazily on first request.

import type { AiProviderName, EdgeType, GlossaryEntry, WorkDetail, WorkSummary } from '../../../shared/types.js';
import { HeuristicProvider } from './providers/heuristic.js';
import { AnthropicProvider } from './providers/anthropic.js';

/** An AI-suggested edge, not yet inserted. Route layer (routes/ai.ts) owns insertion,
 * dedup against existing (source,target,type) triples (§19.1), and forcing origin/status. */
export interface SuggestedEdge {
  target_work_id: number;
  type: EdgeType;
  confidence: number; // 0..1
  basis: string;
}

/** An AI-proposed chat→work attachment, not yet inserted. Route layer (routes/chats.ts)
 * owns insertion and forcing origin/status per the §4.1–4.2 trust pattern. */
export interface ChatMatch {
  work_id: number;
  confidence: number; // 0..1
  basis: string;
}

export interface AiProvider {
  suggestEdges(work: WorkDetail, candidates: WorkSummary[]): Promise<SuggestedEdge[]>;
  /** Which candidate works does this conversation transcript actually discuss?
   * Receives a length-capped transcript excerpt, never the raw upload. */
  matchChat(transcriptExcerpt: string, candidates: WorkSummary[]): Promise<ChatMatch[]>;
  summarize(work: WorkDetail, scope: 'abstract' | 'full'): Promise<string>;
  glossary(work: WorkDetail, scope: 'abstract' | 'full'): Promise<GlossaryEntry[]>;
  /**
   * Not part of the §7 interface table, but required by POST /works/:id/ai/explain (§13.6):
   * heuristic answers honestly that it cannot truly answer free-form questions and falls
   * back to an extractive summary; anthropic answers for real. Living here (rather than
   * inline in the route) keeps all provider-specific behavior — and the tier/scope
   * boundary the route already enforces before calling in — in one place.
   */
  explain(work: WorkDetail, scope: 'abstract' | 'full', question: string, subunitId?: number | null): Promise<string>;
}

/** Provenance stamped on every ai_outputs / AI-origin edges row (spec §7, §4 schema). */
export const MODEL_INFO: Record<AiProviderName, { model: string; model_version: string }> = {
  heuristic: { model: 'heuristic-tfidf', model_version: '1.0' },
  anthropic: { model: 'claude-sonnet-5', model_version: '2026-01' },
};

const PROVIDER_NAME: AiProviderName = process.env.AI_PROVIDER === 'anthropic' ? 'anthropic' : 'heuristic';

// Fail fast (§7: "if unset at boot with AI_PROVIDER=anthropic, fail fast — throw on
// startup, not on first request"). Module-scope throw fires the moment this file is
// imported, which happens during index.ts's route-wiring at process start.
if (PROVIDER_NAME === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set. Set the env var, or unset AI_PROVIDER " +
      "(or set it to 'heuristic') to run with the zero-cost deterministic provider.",
  );
}

let instance: AiProvider | undefined;

/** Reads env AI_PROVIDER ('anthropic'|'heuristic'), default 'heuristic' (spec §7). Cached singleton. */
export function getAiProvider(): AiProvider {
  if (!instance) {
    instance = PROVIDER_NAME === 'anthropic' ? new AnthropicProvider() : new HeuristicProvider();
  }
  return instance;
}

/** The resolved provider name, for stamping MODEL_INFO onto ai_outputs / AI edges. */
export function getAiProviderName(): AiProviderName {
  return PROVIDER_NAME;
}
