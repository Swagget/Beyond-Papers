# Beyond Papers — Design Reference

Companion to `Requirements.md`. Styles live in `client/src/styles/{tokens,base,components}.css`
(load in that order). This document explains *why* the tokens look the way
they do, inventories every page with a rough wireframe, and fixes the rules
for two things that must never drift: badge usage and AI labeling.

---

## 1. Principles applied

| Requirement | Design response |
|---|---|
| §0 north star — relevance not virality | No follower counts, no like buttons, no infinite feed. Discover is a ranked *search result list* with a visible, collapsible score explanation (`.ranking-explain`), not a feed. |
| §4.2 AI trust boundary | Violet (`--color-ai*`) is reserved exclusively for AI-generated or AI-inferred content, everywhere, with no exceptions. Every AI surface carries `.badge-ai` or the full `.ai-panel` treatment. AI edges are dashed; human-verified edges are solid. This is enforced structurally, not left to page authors' judgment — see §4 of this doc. |
| §3 license tiers | `.badge-tier-a/b/c` is mandatory on every work card and work-detail header. Gray/amber/green map to "look, don't touch" / "host as-is" / "fully open" — a gradient of permission, not arbitrary color. |
| §1.4 negative/null/inconclusive results | `.badge-result-*` uses a calm slate-blue (`--color-result-neutral`), never red. Cards for negative-result nodes use the exact same `.card` component as positive ones — no visual demotion, no separate "failures" bin. |
| §8 discovery | Graph-native navigation (`.graph-legend`, cytoscape canvas) is a first-class page, not a buried feature. Ranking is explained in place, not hidden behind "why am I seeing this."|
| Two audiences | UI chrome uses the system sans stack (dense, fast); rendered paper bodies use `.article-body` in Georgia-stack serif (comfortable long-form reading) with an AI "explain this to me" affordance available inline for non-specialists, always labeled per §4.3. |
| Accessibility | Single focus-visible treatment (2px accent outline) applied uniformly; color is never the only signal — every AI element also carries the ✳ glyph and/or the word "AI"; every edge type also carries a text label, not just color. |
| Scholarly calm | Warm paper-white background, restrained navy accent, no gradients-as-decoration, no drop-shadow-heavy cards, no marketing typography scale. |

---

## 2. Page inventory

### 2.1 Home / Discover

Search-first, not feed-first. Ranked results, each result a `.card`, with
a per-result `.ranking-explain` toggle (§8.3 transparency). Left rail holds
lightweight facets (license tier, edge type present, node type, date);
no trending/popularity sort — only *relevance* and *recency*.

```
┌─────────────────────────────────────────────────────────────────────┐
│ .site-header  [Beyond Papers]   Discover Graph Submit About   [search]│
├─────────────────────────────────────────────────────────────────────┤
│  .container                                                          │
│  ┌──────────────┐  Discover                                         │
│  │ Filters       │  ┌───────────────────────────────────────────┐   │
│  │ ─────────────│  │ [ search box: "sparse attention long ctx" ]│   │
│  │ License tier  │  └───────────────────────────────────────────┘   │
│  │ [ ] Tier A    │  1,204 results, ranked by relevance              │
│  │ [ ] Tier B    │  ┌───────────────────────────────────────────┐   │
│  │ [x] Tier C    │  │ .card                                     │   │
│  │               │  │ Sparse attention scales sub-quadratically…│   │
│  │ Edge type     │  │ A. Author, B. Author                      │   │
│  │ [ ] refutes   │  │ Abstract…clamped 3 lines…                 │   │
│  │ [ ] replicates│  │ [Tier C][supports 4][Null result]          │   │
│  │               │  │ 18 connections · 6 reviews · 2024-03-01   │   │
│  │ Result type   │  │ ▸ Why this result? 0.82                   │   │
│  │ [ ] negative  │  └───────────────────────────────────────────┘   │
│  │ [ ] null      │  ┌───────────────────────────────────────────┐   │
│  │               │  │ .card  (another result…)                  │   │
│  └──────────────┘  └───────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│ .site-footer  About · Governance · Donate · API · Data export        │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Work detail

The composite node rendered exactly like a conventional paper (§1.1), in
`.article-body` serif, with sub-units addressable inline. Right rail is a
`.tabs`-free stacked set of panels: connections, reviews, AI panel — kept
physically separate from the author's text so the reading column is never
ambiguous about what the authors wrote vs. what the platform generated.

```
┌─────────────────────────────────────────────────────────────────────┐
│ .site-header                                                         │
├───────────────────────────────────────────┬───────────────────────┤
│ .container (article column, max 65ch)      │ right rail (sticky)   │
│                                             │                       │
│ [Tier C] [confirmed] [Null result]         │ ┌───────────────────┐ │
│ # Sparse attention scales sub-quadratically│ │ .ai-panel          │ │
│ A. Author¹, B. Author² · DOI · v3 (pinned) │ │ ✳ AI-generated —   │ │
│                                             │ │ not the authors'   │ │
│ ## Abstract                                │ │ words              │ │
│ .article-body text…                        │ │ "In plain terms…"  │ │
│                                             │ │ claude-3-5-sonnet  │ │
│ .subunit [Hypothesis] #h1  ─────────────── │ │ ·92% accuracy·edit │ │
│ H1: Increasing sparsity…                   │ └───────────────────┘ │
│                                             │ Connections           │
│ .subunit [Method] #m1 ───────────────────  │ .edge-item (human,    │
│ ## Results                                 │  solid, green) supports│
│ .subunit [Result] #r1 (Null result badge)  │ .edge-item (AI,       │
│                                             │  dashed, violet tint) │
│ .subunit [Dataset] #d1, [Code] #c1         │  extends · 78% ·      │
│                                             │  [Confirm][Reject]    │
│ ## References (conventional citation list) │ Reviews                │
│                                             │ .review-card ×N       │
│                                             │ [Write a review]      │
├───────────────────────────────────────────┴───────────────────────┤
│ Comments (per sub-unit, .comment-thread nested)                     │
├─────────────────────────────────────────────────────────────────────┤
│ .site-footer                                                        │
└─────────────────────────────────────────────────────────────────────┘
```

Print (`@media print`): header, right rail chrome, footer, buttons, votes,
tabs all `display:none`; `.article-body` becomes the whole page — renders
like a clean paper (§1.5 export parity).

### 2.3 Graph explorer

Canvas (cytoscape) + filter sidebar + legend. Edge rendering in the canvas
must mirror the CSS language: solid colored line = human-verified, dashed
violet-tinted line = AI-suggested, exactly as `.graph-legend` documents.

```
┌─────────────────────────────────────────────────────────────────────┐
│ .site-header                                                         │
├───────────────┬───────────────────────────────────────────┬─────────┤
│ Filters        │              canvas (cytoscape)            │ .graph- │
│ ───────────── │                                              │ legend  │
│ Center on:     │        ○───supports───▶○                    │ ─────── │
│ [this work]    │        │              ╲╌╌extends╌╌▶○(AI)     │ ● cites │
│                │      refutes                                │ ● supp. │
│ Edge types      │        ▼                                    │ ● refut.│
│ [x] cites      │        ○                                    │ ● repl. │
│ [x] supports   │                                              │ ● exten.│
│ [ ] refutes    │                                              │ ⌐ AI    │
│ [ ] AI-only    │                                              │  (dash) │
│                │                                              │         │
│ Depth: [2 ▾]   │                                              │         │
└───────────────┴───────────────────────────────────────────┴─────────┘
```

### 2.4 Submit / Import

A guided flow: paste a DOI/arXiv ID/PDF, or start blank. License is
resolved (or asked for) immediately and drives what the rest of the form
even shows — sub-unit decomposition fields simply don't render for
Tier A/B sources (§3.2).

```
┌─────────────────────────────────────────────────────────────────────┐
│ .site-header                                                         │
├─────────────────────────────────────────────────────────────────────┤
│ .container                                                            │
│ Submit / Import                                                       │
│ ○ Import by identifier   ○ Upload PDF/LaTeX   ○ Start from blank      │
│ ┌───────────────────────────────────────────────────────────────┐   │
│ │ [ arXiv ID / DOI ______________________ ]  [ Fetch ]           │   │
│ └───────────────────────────────────────────────────────────────┘   │
│ Detected license: CC-BY 4.0 → [Tier C · full node] badge shown       │
│ ⚠ if NC/ND detected: banner explains Tier A/B limits (§3.1/3.2)      │
│                                                                        │
│ .field  Title            .field  Authors (ORCID lookup)              │
│ .field  Abstract          .field  Sub-units (only if Tier C)         │
│   [Hypothesis] [Method] [Result] [Dataset] [Code] [Claim] [Figure]   │
│   + Add sub-unit                                                     │
│                                                                        │
│ [Cancel]                                          [Preview] [Submit] │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.5 Profile

Aggregates authored nodes, sub-units, reviews, data, code — all with the
same credit weight (§6.3), not papers-first-everything-else-footnote.

```
┌─────────────────────────────────────────────────────────────────────┐
│ .site-header                                                         │
├─────────────────────────────────────────────────────────────────────┤
│ .container                                                            │
│ Dr. J. Kim  ORCID 0000-0002-1825-0097   [pseudonym: "kelvin-null"]    │
│ Affiliation · joined 2024                                             │
│                                                                        │
│ .tabs:  Works | Sub-units | Reviews | Datasets & Code | Replications │
│ ┌───────────────────────────────────────────────────────────────┐   │
│ │ .card (their authored node)                                    │   │
│ │ .card (their authored node — a null result, same styling)      │   │
│ └───────────────────────────────────────────────────────────────┘   │
│ Reputation: multi-signal panel (no single vanity number, §9.2)       │
│  · review accuracy track record  · replication contributions         │
│  · CRediT role breakdown (idea / code / data / analysis / review)    │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.6 Review composer

Structured, sub-unit-addressable (§5.4), makes the reviewer's stance and
attribution explicit before publishing — a review is itself a node (§5.1).

```
┌─────────────────────────────────────────────────────────────────────┐
│ .site-header                                                         │
├─────────────────────────────────────────────────────────────────────┤
│ .container (narrow form column)                                       │
│ Reviewing: Sparse attention scales sub-quadratically…                │
│ Attribution: ○ Named (Dr. J. Kim)  ○ Persistent pseudonym             │
│                                                                        │
│ Attach to: ○ Whole node  ○ Sub-unit → [Result R2 ▾]                  │
│ Stance:    ○ Endorse  ○ Critique  ○ Replicate  ○ Dispute an edge     │
│ .field  Review text (serif preview pane alongside)                    │
│ .field  Confidence / evidence links                                   │
│                                                                        │
│ [Save draft]                                    [Publish review]     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.7 Governance / About

Plain, text-forward, trust-establishing — nonprofit structure, POSI
commitments, funding layers, no-ads/no-data-sale statement (§10). Low
visual complexity is itself the design choice here.

```
┌─────────────────────────────────────────────────────────────────────┐
│ .site-header                                                         │
├─────────────────────────────────────────────────────────────────────┤
│ .container.article-body                                               │
│ # Governance                                                          │
│ Beyond Papers is a nonprofit, community-governed foundation…          │
│ ## Funding (never paywalls research)                                  │
│  · Community donations  · Institutional membership                    │
│  · Grants & philanthropy  · Endowment  · Commercial API (Tier C only) │
│ ## POSI commitments        ## Data portability & export               │
│ ## AI accuracy track record (aggregate, linked from every .ai-panel)  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Badge usage rules

| Badge | Shows when | Never shows when |
|---|---|---|
| `.badge-tier-a` / `-b` / `-c` | Always, on every work card and work-detail header — one per work, reflecting that work's *current version's* license (§3.6). | Never omitted. A work with no resolved license shows Tier A (safest default) until license data lands. |
| `.badge-ai` | On any individual piece of AI-generated or AI-inferred content when it's referenced compactly: an unconfirmed edge, an AI-authored glossary term, an inline "explain this" result, a cited AI output (§4.6). | Never on human-authored or human-confirmed content, even if AI originally drafted a suggestion that a human has since confirmed — once confirmed, the edge becomes `.badge-status-confirmed` and drops `.badge-ai` (the AI *origin* stays visible in provenance metadata/history, but the live badge reflects current trust status). |
| `.badge-result-negative/null/inconclusive` | On any node/sub-unit whose result is negative, null, or inconclusive — always alongside the normal tier/edge badges, never replacing them. | Never rendered in `--color-danger` red — that palette is reserved for genuine errors/destructive actions, not for a class of valid scientific finding. |
| `.badge-edge-<type>` | Wherever an edge is referenced compactly outside a full `.edge-item` row (graph tooltips, card badge rows, search facets). | — |
| `.badge-status-suggested` | Same semantic moment as `.badge-ai` on an edge — used interchangeably; prefer `.badge-ai` in dense rows, `.badge-status-suggested` when status is being contrasted directly against confirmed/disputed in one list. | Never on communal/authoritative graph structure (§4.2 — AI edges are excluded from authoritative traversal until confirmed). |
| `.badge-status-confirmed` | Edge or claim has passed the human promotion path (§4.2). | Never assigned by an AI action alone. |
| `.badge-status-disputed` | Edge has active, unresolved contest per §2.4. | Disappears once dispute resolves to confirmed/removed — not left stale. |

General rule: **badges stack, they don't replace.** A single work can
correctly show `[Tier C] [Null result] [confirmed]` all at once — each
communicates an orthogonal fact (reuse rights, finding type, verification
status).

---

## 4. AI-labeling rules (§4.2 — non-negotiable)

1. **Every** surface displaying AI-generated or AI-inferred content carries
   either `.badge-ai` (compact reference) or the full `.ai-panel` treatment
   (substantial content: summaries, explainers, glossaries). There is no
   third option and no "trust me, it's labeled elsewhere."
2. **Color is exclusive.** `--color-ai` (violet) and its `-strong`/`-soft`/
   `-border` variants appear *nowhere* in the system except on AI surfaces.
   If a new component needs a new accent, it must not reach for violet.
3. **Graph edges:** AI-suggested edges render **dashed** in both the CSS
   (`.edge-item-ai`, `border-style: dashed`) and the cytoscape canvas
   (line-style `dashed`, stroke color `--color-ai-border`). Human-verified
   edges render **solid**, colored by edge type. This solid/dashed
   distinction is load-bearing and must never be the *only* differentiator
   removed for a "cleaner" visual — it is restated redundantly via
   `.badge-ai` text, so it survives colorblindness and dashed-line
   rendering edge cases alike.
4. **Confidence is always shown** next to an AI-suggested edge
   (`.edge-item-confidence`), never hidden behind a hover or a click.
5. **AI edges are excluded from counts.** Anywhere a work displays "N
   connections" or similar, that count reflects confirmed edges only;
   AI-suggested edges are surfaced separately (e.g. "18 confirmed · 4
   AI-suggested, unconfirmed").
6. **Provenance line is mandatory** on every `.ai-panel`
   (`.ai-panel-provenance`): model/version and a link to that feature's
   accuracy track record (§4.5), not just a generic "AI" label.
7. **Edit and flag are always both present** on an `.ai-panel` — editability
   (§4.4) and hallucination flagging (§4.5) are not optional extras, they
   are the accountability mechanism that makes AI content safe to show at
   all.
8. **Tier gating is visible, not silent.** For Tier A/B works, AI panels
   either don't render or explicitly state they're operating on
   metadata/abstract only (§4.3) — never presented as if they'd read the
   full text when they legally could not have.
9. **Reader-side vs. graph-side tiers (§4.7):** a private "help me
   understand this" panel may use a lighter-weight inline treatment (still
   violet, still ✳-marked, still labeled) since it's low-stakes and
   unpublished; anything that becomes a *shared graph assertion* (a public
   summary, a proposed edge) must clear the fuller `.ai-panel` /
   `.edge-item-ai` treatment with visible confidence and flag affordances,
   because it is high-stakes the moment it's shared.
