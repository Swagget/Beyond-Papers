# Beyond Papers

A living, graph-structured platform for research. Each node is a composite object that **works exactly like a paper** (renders, exports, cites cleanly) while also decomposing into individually citable sub-units — hypotheses, methods, results, datasets, code — connected to the work that came before and after by **typed edges** (`supports`, `refutes`, `replicates`, `fails_to_replicate`, `extends`, …). Nonprofit by design; research is never paywalled.

> Origin: Hank Green's question — what's the next step for sharing research, beyond research papers?

The full product requirements live in [Requirements.md](Requirements.md); the implementable spec in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the build history in [BUILDLOG.md](BUILDLOG.md).

## What's implemented (the "minimum viable wedge")

- **Composite paper-nodes** with immutable, content-addressed versions — every past state stays citable by SHA-256 hash (`/versions/<hash>`), and every work exports to **LaTeX / BibTeX / Crossref-style JSON** unchanged, so contributing here costs no career credit.
- **License-driven three-tier ingestion** — what the platform may do with a work is decided by its license, never its venue:
  | Tier | Licenses | May do |
  |---|---|---|
  | A | closed, unknown, arXiv-default, all NC | metadata + abstract + graph links only |
  | B | CC-BY-ND | host whole and unchanged — never decomposed, never AI-transformed |
  | C | CC-BY, CC-BY-SA, CC0, public domain, author-contributed | full rich node: sub-units + AI layer |
- **Typed edges with provenance** — who asserted what, when, on what basis. Edges are contestable (votes, disputes).
- **Bounded AI layer** — AI-suggested edges and summaries are a distinct object class: violet-badged everywhere, confidence-scored, model-attributed, excluded from every authoritative count and default graph traversal until a human confirms them. All AI output is editable (tracked) and flaggable, feeding a **public accuracy track record** (`/ai/track-record`). Works with zero API keys via a deterministic heuristic provider; set `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` for real model output.
- **Negative, null, and inconclusive results as first-class nodes**, plus replication nodes surfaced on the original work.
- **Open, creditable review** — reviews are citable works with CRediT-taxonomy contributor roles; comments attach down to the individual sub-unit.
- **Open contribution, two editing modes** — authored objects (only authors edit) vs communal concept nodes (wiki-style), both fully versioned and revertible.
- **Importers** for DOI (Crossref), arXiv (per-version licenses), and OpenAlex (batch), with external-id dedup.
- **Transparent, rigor-weighted discovery** — every search result carries its full score breakdown (relevance / rigor / review activity / recency). No engagement metrics exist anywhere in the schema.

## Quick start

Requires Node.js ≥ 20.

```bash
npm install
npm install --prefix client
npm run build          # build the React client
npm run seed           # populate: live OpenAlex ML/CS imports + demo content
npm start              # serve everything on http://localhost:3000
```

Demo logins (created by seed): `admin / admin-demo-2026` (moderation), `achen / demo-password`, `bkumar / demo-password`, `quasar / demo-password` (pseudonymous).

### Development

```bash
npm run dev            # API server with reload on :3000
npm run dev:client     # Vite dev server on :5173 (proxies /api)
npm run check          # typecheck server + client
npm run test:api       # end-to-end API suite on a throwaway DB (48 checks)
```

### Docker

```bash
docker build -t beyond-papers .
docker run -p 3000:3000 -v beyond-data:/app/data beyond-papers
# then seed inside the container once:
docker exec -it <container> npx tsx scripts/seed.ts
```

## Deployment

Single Node process + a SQLite file — any VPS, Fly.io, Railway, or a box under a desk:

1. `npm install && npm install --prefix client && npm run build`
2. Set env (all optional): `PORT`, `DB_PATH`, `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `SESSION_TTL_DAYS` — see [.env.example](.env.example)
3. `NODE_ENV=production npx tsx server/src/index.ts` (or `npm start`) behind any TLS-terminating reverse proxy.

Back up by copying the SQLite file (`data/beyond.db`).

## Project layout

```
server/src/          Express app: routes/, services/ (AI providers, importers, ranking, export), lib/ (license gates, auth, hashing)
server/src/schema.sql  Full DDL — single source of DB truth
shared/types.ts      Enums + API shapes shared by server and client
client/src/          React SPA: pages/, components/, styles/ (hand-written design system)
scripts/seed.ts      Demo/bootstrap data (FRESH=1 to reseed)
scripts/apitest.ts   Self-contained E2E harness
docs/                ARCHITECTURE.md (spec), DESIGN.md (design system)
```

## The two boundaries that must never regress

1. **Licensing (§3)** — every feature is gated server-side by the work's per-version license. Sub-unit decomposition and full-text AI transformation are Tier C only; Tier B is hosted whole or not at all; NC is excluded from hosting entirely.
2. **AI trust (§4)** — AI output is never authoritative. Suggested edges are born `status='suggested'`, are excluded from ranking/counts/default traversals, and become authoritative only through explicit human confirmation, with provenance preserved.

Both are covered by `npm run test:api` and documented as invariants in the spec.

## License

Code: MIT. Platform-generated content (summaries, sub-unit derivations, transformed views): **CC-BY-SA 4.0** (see Requirements §3.7).
