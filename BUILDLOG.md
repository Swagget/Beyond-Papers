# Build Log

Short record of what was done, in order. Newest at the bottom.

## 2026-07-09 — Session start (overnight autonomous build)

- **22:1x** Read Requirements.md. Decisions taken:
  - **Stack:** Node.js + Express + better-sqlite3 (single process, SQLite file — trivially hostable locally or on any VPS), React 18 + Vite + TypeScript frontend served statically by the same server in production. Hand-written CSS, no frameworks.
  - **AI layer:** pluggable provider — uses Anthropic API when `ANTHROPIC_API_KEY` is set, otherwise a deterministic heuristic provider (TF-IDF similarity for edge suggestions, extractive summaries) so the demo is fully functional with no key and no cost.
  - **Scope:** the "Minimum viable wedge" from Requirements.md, implemented end to end, plus governance/about pages.
- Created 6 specialized subagents in `.claude/agents/`: software-architect, ui-designer, backend-engineer, frontend-engineer, qa-engineer, docs-writer (sonnet/haiku models to keep cost down). Note: custom agent types load at session start, so this session runs them via general-purpose agents with the same role prompts; the definitions are active for any future session.
- Added `.gitignore`, this build log. Committed + pushed.
- **22:3x** Scaffold built and pushed (commit `d4348eb`), both sides typecheck:
  - Full SQLite DDL (`server/src/schema.sql`): users/sessions, works, immutable content-addressed `work_versions` (per-version license — §1.3/§3.6), subunits (§1.2), authors/authorships with CRediT roles (§6.2), typed edges with AI provenance + status + votes (§2, §4.1–4.2), threaded per-subunit comments (§5.4), ai_outputs with edit lineage (§4.3–4.4), flags (§4.5), FTS5 search index.
  - `shared/types.ts` — single source of truth for all enums/interfaces, incl. license→tier mapping (§3.1–3.2).
  - Server libs: content hashing, license gates (`canDecompose`/`canStoreFullText`/`canAiTransform`), scrypt session auth, JSON error envelope.
  - Client shell: router with 12 routes, API wrapper, auth context, sticky header.
- Launched architecture-spec agent (docs/ARCHITECTURE.md) and design-system agent (tokens/base/components CSS + docs/DESIGN.md) in parallel.
- Verified OpenAlex API live + response shape (license field, ORCID, referenced_works, inverted abstract) for the importer/seed phase.
- **23:0x** Design system landed (violet reserved exclusively for AI content; 12 edge-type colors; tier chips; dignified negative-result styling). Client builds with it. Pushed.
- **23:3x** Architecture spec landed (1029 lines: full DDL, ~50 routes, ranking formula, invariants, QA checklist). Reconciled scaffold to it — schema rebuilt (is_admin, authorship user/author split, AI-output edit chains, comment soft-delete, edge provenance CHECKs + UNIQUE triple), shared/types.ts aligned, libs renamed to spec API. Deviations documented in spec §19. Pushed.
- **23:4x** Wrote shared `workStore` service (sole writer of works/versions — owns license write-gates + content addressing) and shared trust-surface components (Badges, WorkCard). Launched TWO parallel implementation workflows:
  - Backend: 7 sonnet agents (auth/users, works, edges, reviews+comments, AI+flags, importers, search/graph/export) — disjoint file ownership.
  - Frontend: 6 agents (home+discovery, work detail, graph+versions, forms, profile/auth/admin, static pages).
- Meanwhile wrote scripts/seed.ts (live OpenAlex ML/CS beachhead + native demo content incl. negative-result replication, concept node, review, AI suggestions, resolved flag), scripts/apitest.ts (self-contained E2E harness on temp DB), Dockerfile, .env.example. Pushed.

## 2026-07-10 — Implementation lands, QA, ship

- **00:1x** Backend workflow finished: all 7 modules, zero type errors on integration. **E2E suite: 48/48 passing** on first full run — license gates (Tier A/B/C refusals), AI trust boundary (suggested-edge exclusion, promotion), immutability (revert reproduces hash), state machine, exports. Pushed.
- **00:2x** Seed verified against live OpenAlex: 40 imported works w/ real licenses (mixed tiers), 50 metadata `cites` edges, native demo content (negative-result replication w/ `fails_to_replicate` edge, communal concept node, dataset node, review-as-work, AI summary + 3 suggested edges, upheld + open flags). Fixed FK ordering in FRESH wipe. Pushed.
- **00:3x** Frontend workflow finished: all 17 pages + work-detail components; client builds clean. Code-split cytoscape (main bundle 281 kB). Live smoke test on seeded DB: SPA, search w/ ranking breakdown, work detail, graph traversal, AI track record all serving. Pushed.
- **00:4x** Wrote README (quick start, deploy, layout, the two boundaries) + MIT LICENSE. Pushed.
- **01:0x** Adversarial QA workflow (4 attack dimensions → per-finding adversarial verification, 11 agents): 9 raw findings, 8 confirmed real, 0 false-accepts. Fixed all 8:
  - **Blocker:** AI outputs (summaries/glossaries) generated at Tier-C full-text scope survived a later license downgrade to Tier A/B and kept publicly leaking full-section text. Fix: `addVersion` now retires all current AI outputs in the same transaction when the new tier forbids full-text transformation.
  - Major: flag `upheld+remove` now removes the whole edit chain (an edit made between flag and resolution no longer survives); explainer Q&As accumulate instead of hiding the previous answer; disputed edges got their legal re-affirm/reject UI.
  - Minor: header nav pointed at old route names; review-edit kind mis-default; revert-path downgrade now 409 like PATCH; `/works/:id/edges` 404s on missing work.
  - Added 3 regression tests; **E2E suite now 53/53.** Pushed.
- **01:1x** Demo server restarted on fixed code, healthy at http://localhost:3000 (seeded DB). Final push.

### How to run
`npm install && npm install --prefix client && npm run build && npm run seed && npm start` → http://localhost:3000
Logins: `admin/admin-demo-2026`, `achen/demo-password`, `bkumar/demo-password`, `quasar/demo-password` (pseudonymous).

### Cost/agent summary
2 design agents + 7 backend + 6 frontend + 11 QA (find+verify) agents, all sonnet/haiku via workflows; orchestration and shared/load-bearing code (schema, workStore, trust-surface components, seed, E2E harness) done in the main loop.
