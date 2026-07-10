# Build Log

Short record of what was done, in order. Newest at the bottom.

## 2026-07-09 — Session start (overnight autonomous build)

- **22:1x** Read Requirements.md. Decisions taken:
  - **Stack:** Node.js + Express + better-sqlite3 (single process, SQLite file — trivially hostable locally or on any VPS), React 18 + Vite + TypeScript frontend served statically by the same server in production. Hand-written CSS, no frameworks.
  - **AI layer:** pluggable provider — uses Anthropic API when `ANTHROPIC_API_KEY` is set, otherwise a deterministic heuristic provider (TF-IDF similarity for edge suggestions, extractive summaries) so the demo is fully functional with no key and no cost.
  - **Scope:** the "Minimum viable wedge" from Requirements.md, implemented end to end, plus governance/about pages.
- Created 6 specialized subagents in `.claude/agents/`: software-architect, ui-designer, backend-engineer, frontend-engineer, qa-engineer, docs-writer (sonnet/haiku models to keep cost down).
- Added `.gitignore`, this build log.
