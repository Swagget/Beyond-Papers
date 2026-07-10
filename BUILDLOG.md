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
