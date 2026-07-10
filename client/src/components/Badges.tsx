// Shared badge components — the trust surfaces (§4.2, §3, §1.4).
// Every page renders license tiers, AI provenance, result nature and edge
// types through these, so the visual language never drifts.

import type { EdgeStatus, EdgeType, ResultNature, Tier, WorkKind } from '@shared/types';

const TIER_LABEL: Record<Tier, string> = {
  A: 'Tier A — metadata',
  B: 'Tier B — hosted, no derivatives',
  C: 'Tier C — open, transformable',
};

export function TierBadge({ tier, license }: { tier: Tier; license?: string }) {
  return (
    <span className={`badge badge-tier-${tier.toLowerCase()}`} title={`${TIER_LABEL[tier]}${license ? ` (${license})` : ''}`}>
      Tier {tier}
      {license ? <span className="badge-license"> · {license}</span> : null}
    </span>
  );
}

/** Unmissable AI marker. Any AI-generated object MUST carry this (§4.2). */
export function AiBadge({ label = 'AI-suggested' }: { label?: string }) {
  return <span className="badge badge-ai">{label}</span>;
}

export function ResultBadge({ nature }: { nature: ResultNature }) {
  if (nature === 'na' || nature === 'positive') return null; // positive is the unmarked default
  const text = nature === 'null' ? 'Null result' : nature === 'negative' ? 'Negative result' : 'Inconclusive';
  return <span className={`badge badge-result-${nature}`}>{text}</span>;
}

export function EdgeTypeBadge({ type }: { type: EdgeType }) {
  return <span className={`badge badge-edge-${type}`}>{type.replace(/_/g, ' ')}</span>;
}

export function EdgeStatusBadge({ status }: { status: EdgeStatus }) {
  if (status === 'rejected') return null; // rejected edges are not rendered in lists
  return <span className={`badge badge-status-${status}`}>{status}</span>;
}

const KIND_LABEL: Record<WorkKind, string> = {
  paper: 'Paper',
  review: 'Review',
  replication: 'Replication',
  concept: 'Concept',
  dataset: 'Dataset',
  code: 'Code',
};

export function KindBadge({ kind }: { kind: WorkKind }) {
  if (kind === 'paper') return null; // papers are the unmarked default
  return <span className="badge">{KIND_LABEL[kind]}</span>;
}

export function ConfidencePct({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null;
  return <span className="edge-item-confidence">{Math.round(confidence * 100)}% confidence</span>;
}
