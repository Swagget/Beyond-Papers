# Requirements

A living, graph-structured platform for research where each **node** is a rich composite object (functioning as a research paper) that can also be decomposed into smaller typed units. Nodes are connected by typed edges to the work that came before and after. The system is backward-compatible with existing literature, augmented by AI, and subject to open, creditable peer review. It is run as a **nonprofit** and never paywalls research.

**Design north star:** keep the *graph topology* of social networks, refuse the *attention-economy mechanics*. Optimize discovery for relevance and rigor, never for virality. It must feel seamless for working researchers — flowing with how they already publish, not against it — while staying approachable to anyone outside science, so a curious non-specialist can navigate and understand the work.

---

## 1. Core node & content model

**1.1 Composite nodes as first-class papers.** A node must be able to render, export, and be cited exactly like a conventional research paper (abstract, sections, figures, references), so contributors pay no penalty for using the platform.

**1.2 Smaller typed sub-units layered on top.** Within a node, individual units — hypothesis, method, result, dataset, code block, claim, figure — must be individually addressable, linkable, and creditable, without forcing the author to abandon the paper-level whole. (Available only for content the platform is licensed to transform — see §3.)

**1.3 Immutable, content-addressed versions.** Every node and sub-unit is versioned; any past state remains permanently referenceable (hash- or DOI-pinned) even as the living version evolves. You must be able to cite a frozen snapshot.

**1.4 Negative, null, and inconclusive results as first-class nodes.** Not second-class attachments — full nodes with the same status and creditability as positive results.

**1.5 Standard export.** A node must export to LaTeX / PDF / standard metadata so it can be submitted to a conventional venue unchanged. Round-tripping is a requirement, not a nice-to-have.

## 2. Graph & typed connections

**2.1 Typed edges, not flat "cites."** Support a controlled vocabulary of relationship types: *cites, supports, refutes, replicates, fails-to-replicate, extends, uses-method-of, provides-data-for, corrects, supersedes,* etc.

**2.2 Directionality and temporality.** Edges encode "came before / came after" and can be traversed in both directions (ancestry and descendants of an idea).

**2.3 Edge-level attribution and provenance.** Every edge records who (or what) asserted it, when, and on what basis (human-verified vs. AI-inferred — see §4).

**2.4 Contested edges.** An edge (e.g. "refutes") can itself be disputed, discussed, and down/up-weighted, since it is a claim about others' work.

## 3. Backward compatibility & interoperability

**3.1 Three-tier ingestion, driven by license — not by venue.** Whether a work can be hosted or transformed depends on its specific license, never on where it appeared. "Open access" and "on arXiv" do **not** by themselves grant reuse rights.

- **Tier A — metadata + link (universal).** Title, authors, abstract, citation links, and DOI for *any* work, open or closed. Legally clean, and gives the graph universal coverage.
- **Tier B — host whole, unchanged (no-derivatives licenses).** Works under CC-BY-ND may be redistributed only in full and unmodified: **no** splitting into sub-units, **no** AI-generated derivatives. (The NC variant, CC-BY-NC-ND, is excluded — see §3.2.)
- **Tier C — full rich node, transformable (permissive + author-contributed).** Works under CC-BY / CC-BY-SA / CC0 / public domain, or contributed directly by their authors, may be hosted, decomposed into sub-units (§1.2), and processed by the AI layer (§4).

**3.2 License is the gate for every feature; NC is excluded for now.** Sub-unit decomposition (§1.2) and AI transformation (§4) are available for Tier C only. Note that the default arXiv license (used by most arXiv papers) is *not* permissive — it grants arXiv distribution rights but not third-party reuse, so most arXiv papers are Tier A unless the author chose a CC license. **NonCommercial (NC) content is excluded from hosting and transformation for now**: NC works still appear in the universal metadata graph (Tier A) but are not hosted in full, decomposed, or fed to the AI layer. Rationale: NC forbids commercial reuse, which is directly incompatible with the CC-BY-SA license the platform applies to its own generated content (§3.7), so NC material could not be blended into platform outputs anyway. This drops CC-BY-NC, CC-BY-NC-SA, and CC-BY-NC-ND from the transformable/hostable pool; it is a deliberate simplification to revisit later, at the cost of some open-access coverage.

**3.3 Seed the graph on day one via metadata.** Bootstrap universal coverage by importing existing metadata corpora (e.g. OpenAlex's 250M+ works, Crossref, arXiv, PubMed) so the network is populated at launch; fill in Tier-C full content for the permissive / author-contributed subset over time. No lonely-island launch.

**3.4 Importers.** Ingest from arXiv, DOI/Crossref, PubMed, OpenAlex, PDF, and LaTeX. Handle deduplication and author disambiguation on import.

**3.5 Persistent external identifiers.** ORCID for people; DOI/Crossref for objects. Interoperate rather than re-inventing identity.

**3.6 Per-work, per-version license tracking.** Store the license of every work and every version (arXiv versions can carry different licenses), because it determines which tier and which features apply. Obtain IP counsel before large-scale ingestion — this section is not legal advice.

**3.7 Outbound licensing of generated & derivative content.** Platform-generated derivatives (AI summaries, sub-units, transformed views) are published under **CC-BY-SA 4.0** by default, mirroring Wikipedia, so openness propagates downstream and outputs stay commercial-friendly. Standardize on version **4.0** specifically (it has the cleanest compatibility behavior — e.g. one-way compatibility with GPLv3 — whereas older SA versions are not all mutually compatible). The system tracks which sources feed each derivative and refuses to combine license-incompatible sources into a single output. Because Tier-C inputs are limited to CC-BY / CC-BY-SA / CC0 / author-contributed (all one-way compatible into a CC-BY-SA work) and NC is excluded (§3.2), these combinations stay clean by construction.

## 4. AI layer (assistive, bounded, auditable)

**4.1 AI-suggested typed connections.** AI proposes typed edges between works — but AI edges are a distinct object class carrying a confidence score and provenance, and are visually and semantically separated from human-verified edges.

**4.2 Human promotion path.** *Every* AI-inferred edge only becomes "authoritative" after a qualified human confirms it — regardless of edge type. Until confirmed, it is an AI *suggestion* and must be unmistakably presented as such in the UI (visually distinct, labeled as machine-inferred, and excluded from any count, ranking, or authoritative traversal).

**4.3 Summarization & clarification.** AI generates plain-language summaries, term glossaries, and "explain this to me" comprehension help for readers struggling with material — clearly labeled as AI-generated and never presented as the authors' words. Derivative AI output over full text is generated only for Tier-C works (§3.2); for Tier A/B, AI operates on metadata and abstracts only.

**4.4 Editability.** AI-generated content (summaries, edges, explanations) is human-editable, with edits tracked and attributed.

**4.5 Hallucination flagging + workflow.** Users can flag AI output as inaccurate. Flags feed a defined workflow: triage, correction or removal, and a per-feature accuracy track record that is visible over time.

**4.6 AI output is not citable as authoritative** by default; if cited, it is marked as machine-generated with model/version provenance.

**4.7 Reader-side vs. graph-side AI are different trust tiers.** Private "help me understand" assistance is low-stakes; shared graph assertions (edges, public summaries) are high-stakes and held to stricter verification.

## 5. Peer review & quality control

**5.1 Review as a first-class, creditable, attributable artifact.** Reviews are themselves nodes: named (or persistently pseudonymous) credit, citable, and part of the graph.

**5.2 Open + continuous review.** Review is not a one-time gate before publication but an ongoing, post-publication-capable process (comment, critique, endorse, replicate).

**5.3 Review capacity vs. open contribution.** Because open contribution increases volume while review labor stays flat, rewarding review must be built in from the start, not bolted on.

**5.4 Granular commenting.** Comments/annotations attach at the sub-unit level (a specific claim, figure, or line of code), not just the whole node.

**5.5 Corrections, retractions, and versioned errata.** A defined workflow for correcting or retracting, with the history preserved and edges (`corrects`, `supersedes`) updated.

## 6. Identity, attribution & credit

**6.1 Public researcher profiles** tied to persistent identity (ORCID), aggregating authored nodes, sub-units, reviews, data, and code.

**6.2 Granular contributor roles.** Adopt a CRediT-style taxonomy so a composite node's bundle of idea + math + code + data + review credits the right people for the right parts.

**6.3 Credit for non-paper artifacts.** Datasets, code, reviews, replications, and negative results all generate career-legible, citable credit — this is central to the incentive design.

**6.4 Pseudonymity option** with persistent identity, so contributors can build reputation without always exposing legal identity, where appropriate.

## 7. Reproducibility & research artifacts

**7.1 Code, data, math, and experiments as linked, typed artifacts** within a node.

**7.2 Reproducibility scope — linked repo with pinned toolchain.** Reproducibility is anchored to a **linked code repository**, not hosted execution, plus a captured **execution manifest**: the date the work was run (corresponding to the repo's upload date) and pinned versions of every language, package, and dependency used to execute the code. Anyone re-running the pipeline can then recover the exact toolchain rather than guessing at versions — the primary defense against environment rot. (Where feasible, capture the manifest automatically from the environment rather than relying on the author to record it by hand.)

**7.3 Dataset handling.** Support large, external, and access-controlled datasets by reference, with licensing metadata, rather than assuming everything can be hosted openly.

**7.4 Replication tracking.** Nodes whose purpose is "I re-ran X — here's what happened," linked by `replicates` / `fails-to-replicate` edges and surfaced on the original node.

## 8. Discovery (relevance, not virality)

**8.1 Rigor- and relevance-ranked discovery**, explicitly *not* engagement- or popularity-optimized. No follower-count leaderboards, no viral feed.

**8.2 Graph-native navigation.** Explore by ancestry, descendants, typed-edge paths, topic clusters, and "what refutes / replicates / extends this."

**8.3 Transparent ranking.** How things are surfaced is explainable and resistant to manipulation.

## 9. Integrity, reputation & anti-gaming

**9.1 Assume adversarial users from day one.** Any number that affects careers will be gamed (citation rings, sockpuppets, self-promotion, review collusion).

**9.2 Goodhart-resistant reputation.** Avoid single vanity metrics (the ResearchGate failure mode); prefer multi-signal, context-aware, hard-to-inflate reputation.

**9.3 Fraud detection & moderation.** Workflows for fabrication, p-hacking, plagiarism, and coordinated manipulation — harder under openness, so designed in early.

**9.4 Sybil resistance** tied to verified identity where stakes are high.

## 10. Governance, funding & legal

**10.1 Nonprofit foundation, community-governed — no company control.** Structure as a nonprofit (e.g. US 501(c)(3) or equivalent), modeled on Wikimedia / arXiv / OpenAlex: the foundation hosts and protects the infrastructure but does **not** control the research content, which is governed by the community. No advertising, no single corporate owner, no capture, no selling of user data. Adopt the **Principles of Open Scholarly Infrastructure (POSI)** — open-source code, open data, portability, and community governance — as the explicit backbone.

**10.2 Layered funding that never paywalls research.** No funding pillar may gate access to research content or the graph itself. The layers:

- **Community donations + optional "supporter" status.** Primarily many small gifts (Wikimedia's core model, ~$11 average). Supporter status may grant recognition, cosmetic badges, and power-user conveniences (higher API limits, advanced tooling, priority support) — but **never** access to research.
- **Institutional membership.** Universities, libraries, and labs contribute annually (arXiv's model, with affiliate/sponsor tiers) — the most stable base for shared scholarly infrastructure.
- **Grants & philanthropy.** Foundation funding (the kind that seeded OpenAlex and Wikimedia) for the build phase — necessary early, not sufficient alone.
- **Endowment.** A permanent fund for long-term security and independence (Wikimedia's perpetuity model).
- **Value-added services for commercial reusers.** Paid high-volume, high-reliability API and bulk access for companies (search engines, AI firms) — *revenue from services, not data* — so heavy commercial users subsidize free access for everyone else (à la Wikimedia Enterprise / OpenAlex premium). For now, this path is kept clear of any NC/ND-restricted content (Tier A/B); which content may flow through commercial services is deferred to a later legal review.

**10.3 Data portability & no lock-in.** Contributors can export their work and the graph relationships; open standards and open licensing of the corpus. A POSI requirement, and the thing that keeps community trust and prevents enclosure.

**10.4 Legal compliance.** Copyright/licensing per §3 (tracked per work and per version), data protection/privacy for user and profile data, and clear terms and liability for AI-generated content. Not legal advice — obtain IP counsel before large-scale ingestion.

## 11. Adoption & incentives (the meta-requirement)

**11.1 A wedge that imposes no career penalty.** The single most important requirement. Because career credit runs on conventional papers, early adopters must gain (extra credit, better tools, discoverability) without losing the paper-based credit their jobs depend on — hence composite nodes that *are* papers (§1.1) and export cleanly (§1.5).

**11.2 Start where the behavior already exists.** Launch in a subfield whose norms already match the design (e.g. ML/CS with arXiv + GitHub + open review) rather than fighting uphill in fields without those habits.

**11.3 Additive, not substitutive.** Using the platform should augment the existing publishing workflow, not require abandoning it — until the network effect is strong enough to stand alone.

## 12. Open contribution model

**12.1 Low-friction, open contribution.** Anyone can propose new objects — nodes, typed edges, sub-units, comments, corrections, and replications — without passing a gatekeeper at submission. The barrier to *entry* is minimal; quality is controlled by review *after* the fact (§5), not by a wall at the door. This is the "open and easy to contribute" principle at the heart of the project.

**12.2 Review is the filter, not the gate.** Contributions enter the graph readily, but their status, weight, and discoverability depend on open, continuous review (§5.2) and the trust/reputation system (§9). Openness of contribution and rigor of review are separate mechanisms — low barrier in, quality sorted afterward.

**12.3 Authored vs. communal objects — two editing modes.** Because research credit can't work purely wiki-style, editability splits by object type:

- **Authored objects** (a researcher's paper-node, their sub-units, their data/code) are edited only by their authors, or by others through a suggest-and-review flow — never silently overwritten. Version history and attribution (§1.3, §6) are preserved.
- **Communal objects** (concept/idea nodes owned by no single author, the graph's typed-edge structure, glossaries, collaborative summaries) are openly editable wiki-style, subject to the same versioning, provenance, and revert capability.

**12.4 Concept and idea nodes as first-class, communal node types.** Beyond paper-shaped nodes, the graph supports standalone concept/idea nodes that no single author owns — the natural home for open collaborative editing, and for connecting work that shares an idea rather than a citation. (This realizes the "idea/concept" node types from the original vision.)

**12.5 Provenance, versioning, and revert for every edit.** Every contribution and edit — authored or communal — is versioned, attributed to a contributor (or persistent pseudonym, §6.4), and reversible, so openness never means loss of history or unaccountable change. This is also a front-line defense for the integrity concerns in §9.

---

## Minimum viable wedge (what v1 must have)

If everything else waits, these are the load-bearing requirements without which the project can't earn its first users:

- **1.1** Composite nodes that function as, and **1.5** export cleanly to, real papers — *no career penalty.*
- **3.1 / 3.2 / 3.3** License-driven, three-tier ingestion of existing literature so the graph isn't empty *and* stays legal.
- **2.1** Typed edges — the core thing a citation list can't do.
- **1.4** Negative/null results as first-class nodes — a reason to exist that papers structurally lack.
- **4.1 / 4.2 / 4.5** AI-suggested edges + summaries, clearly bounded, human-promotable, and flaggable.
- **5.1 / 6.2 / 6.3** Creditable reviews and granular, non-paper credit — so contributing *pays* people.
- **10.1** Nonprofit, community-governed footing from the start — trust is hard to retrofit.
- **11.2** A single beachhead subfield.
- **12.1 / 12.3** Low-friction open contribution with authored-vs-communal editing — the "easy to contribute" promise, without breaking attribution.

Everything else (executable reproducibility, sophisticated reputation, endowment, formal membership program) can mature as the network grows — but the **licensing boundary (§3.1–3.2)** and the **AI trust boundary (§4.1–4.2)** must be right from the very first line of code, because they're expensive and legally dangerous to retrofit.