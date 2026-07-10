// Seed script — populates the graph per §3.3 (no lonely-island launch) with the
// ML/CS beachhead (§11.2): live OpenAlex metadata imports (mixed real licenses →
// mixed tiers) + rich native Tier-C demo content exercising every feature.
//
// Run: npm run seed          (idempotent-ish: skips if works already exist; FRESH=1 wipes first)

import { db } from '../server/src/db.js';
import { hashPassword } from '../server/src/lib/auth.js';
import { contentHash } from '../server/src/lib/hash.js';
import { createWork, getWorkDetail, addVersion } from '../server/src/services/workStore.js';
import { importOpenalexBatch } from '../server/src/services/importers/openalex.js';
import { getAiProvider } from '../server/src/services/aiProvider.js';

const FRESH = process.env.FRESH === '1';

function log(msg: string) {
  console.log(`[seed] ${msg}`);
}

if (FRESH) {
  log('FRESH=1 — wiping database…');
  db.pragma('foreign_keys = OFF'); // works.current_version_id ↔ work_versions is circular
  for (const t of ['flags', 'ai_outputs', 'comments', 'edge_votes', 'edges', 'authorships', 'authors', 'subunits', 'work_versions', 'works', 'sessions', 'users']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.pragma('foreign_keys = ON');
}

const existing = (db.prepare('SELECT COUNT(*) AS c FROM works').get() as { c: number }).c;
if (existing > 0) {
  log(`Database already has ${existing} works — nothing to do (set FRESH=1 to reseed).`);
  process.exit(0);
}

// ---------- 1. Users ----------

function createUser(username: string, password: string, display: string, opts: { admin?: boolean; pseudonym?: boolean; orcid?: string; bio?: string } = {}): number {
  const res = db
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, is_pseudonym, orcid, bio, is_admin)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(username, hashPassword(password), display, opts.pseudonym ? 1 : 0, opts.orcid ?? null, opts.bio ?? null, opts.admin ? 1 : 0);
  return Number(res.lastInsertRowid);
}

const admin = createUser('admin', 'admin-demo-2026', 'Site Admin', { admin: true, bio: 'Moderation account for the demo instance.' });
const alice = createUser('achen', 'demo-password', 'Alice Chen', {
  orcid: '0000-0002-1825-0097',
  bio: 'ML researcher. Interested in in-context learning and honest negative results.',
});
const bob = createUser('bkumar', 'demo-password', 'Bikram Kumar', {
  bio: 'Reproducibility enthusiast. I re-run things.',
});
const quasar = createUser('quasar', 'demo-password', 'Quasar', {
  pseudonym: true,
  bio: 'Persistent pseudonym (§6.4). Reputation without a legal name.',
});
log(`users: admin=${admin} alice=${alice} bob=${bob} quasar=${quasar}`);

// ---------- 2. Live OpenAlex imports (ML/CS beachhead) ----------

const openalexIdToWorkId = new Map<string, number>();
const citedIdsByWork = new Map<number, string[]>();

const queries = [
  'transformer attention language model',
  'deep reinforcement learning',
  'protein structure prediction deep learning',
  'reproducibility crisis machine learning',
  'diffusion model image generation',
];

for (const q of queries) {
  try {
    const items = await importOpenalexBatch(q, 8);
    for (const item of items) {
      const w = item.work;
      if (w.openalex_id) openalexIdToWorkId.set(w.openalex_id, w.id);
      const cited = (item as { cited_openalex_ids?: string[] }).cited_openalex_ids;
      if (cited?.length) citedIdsByWork.set(w.id, cited);
    }
    log(`openalex "${q}": ${items.length} works`);
  } catch (err) {
    log(`openalex "${q}" FAILED (offline?): ${(err as Error).message} — continuing`);
  }
}

// cites edges from OpenAlex referenced_works where both endpoints landed (§3.3 metadata graph).
let citeCount = 0;
const insertEdge = db.prepare(
  `INSERT OR IGNORE INTO edges (source_work_id, target_work_id, type, origin, asserted_by_user, basis, status, confirmed_by, confirmed_at)
   VALUES (?, ?, ?, 'human', ?, ?, 'confirmed', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
);
for (const [workId, cited] of citedIdsByWork) {
  for (const cid of cited) {
    const target = openalexIdToWorkId.get(cid);
    if (target && target !== workId) {
      insertEdge.run(workId, target, 'cites', admin, 'OpenAlex referenced_works metadata', admin);
      citeCount++;
    }
  }
}
log(`cites edges from metadata: ${citeCount}`);

// ---------- 3. Native Tier-C demo works ----------

const alicePaper = createWork({
  kind: 'paper',
  result_nature: 'positive',
  editing: 'authored',
  title: 'Sparse Attention Routing Improves Sample Efficiency in Small Language Models',
  abstract:
    'We introduce sparse attention routing (SAR), a drop-in modification to multi-head attention that routes tokens to a learned subset of heads. On models from 60M to 410M parameters, SAR improves sample efficiency by 12-18% on language modeling benchmarks while reducing attention FLOPs by roughly a third. We release code, training manifests, and all negative ablations.',
  sections: [
    { heading: 'Introduction', body: 'Attention layers dominate the compute budget of transformer language models. We ask whether all heads need to see all tokens, and find they do not.\n\nOur contribution is a routing mechanism that is learned end-to-end and requires no auxiliary losses.', order: 1 },
    { heading: 'Method', body: 'Sparse Attention Routing assigns each token to k of H heads via a lightweight router (a single linear layer followed by top-k selection). Gradients flow through the straight-through estimator.\n\nWe pin the full toolchain in the linked repository: Python 3.11.6, PyTorch 2.3.1, CUDA 12.1 (§7.2 execution manifest).', order: 2 },
    { heading: 'Results', body: 'Across four model sizes, SAR matches or exceeds dense attention with 33% fewer attention FLOPs. Gains are largest in the low-data regime: at 10B training tokens, SAR reaches the dense baseline perplexity with 18% fewer steps.', order: 3 },
    { heading: 'Limitations', body: 'We evaluate only on English text and models under 1B parameters. Routing overhead becomes non-negligible below 60M parameters.', order: 4 },
  ],
  references: [
    { label: '[1]', raw: 'Vaswani et al. Attention Is All You Need. NeurIPS 2017.', doi: '10.48550/arXiv.1706.03762' },
    { label: '[2]', raw: 'Shazeer et al. Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer. ICLR 2017.' },
  ],
  license: 'platform-cc-by-sa',
  created_by: alice,
  authors: [
    { user_id: alice, position: 1, credit_roles: ['conceptualization', 'methodology', 'software', 'writing_original_draft'] },
    { user_id: quasar, position: 2, credit_roles: ['formal_analysis', 'validation', 'writing_review_editing'] },
  ],
});
log(`alice paper: work ${alicePaper.id}`);

// Sub-units (§1.2) — individually addressable, citable pieces.
const subunitStmt = db.prepare(
  `INSERT INTO subunits (work_id, version_id, type, title, content, content_hash, order_index, created_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
const subunits: Array<[string, string, string]> = [
  ['hypothesis', 'H1: head specialization', 'Not all attention heads need to attend to all tokens; a learned top-k routing preserves task-relevant information at lower cost.'],
  ['method', 'SAR router', 'A single linear layer scores token-head affinity; top-k selection with straight-through gradients routes each token to k of H heads.'],
  ['result', 'Sample-efficiency gain', 'At 10B training tokens, SAR reaches dense-baseline perplexity with 18% fewer optimization steps (60M-410M params).'],
  ['code', 'Reference implementation', 'https://example.org/sar-repo — pinned manifest: Python 3.11.6, PyTorch 2.3.1, CUDA 12.1, run date 2026-05-14 (§7.2).'],
];
subunits.forEach(([type, title, content], i) => {
  subunitStmt.run(alicePaper.id, alicePaper.current_version_id, type, title, content, contentHash({ type, title, content }), i, alice);
});
log(`subunits on paper ${alicePaper.id}: ${subunits.length}`);

// A second version, so history/revert has something to show (§1.3).
addVersion(alicePaper.id, {
  abstract: alicePaper.abstract + ' Version 2 adds the 410M-parameter ablation requested by reviewers.',
  change_note: 'Add 410M ablation to abstract',
  created_by: alice,
});

// Negative-result replication (§1.4 + §7.4) — first-class, same status as any node.
const bobReplication = createWork({
  kind: 'replication',
  result_nature: 'negative',
  editing: 'authored',
  title: 'SAR Gains Do Not Transfer to Code Models: A Replication of Sparse Attention Routing',
  abstract:
    'We replicate Chen & Quasar (2026) on code-generation models (160M-410M parameters, 3 seeds each). Language-modeling gains reproduce, but on code benchmarks SAR shows no sample-efficiency improvement (95% CI includes zero across all sizes). We conclude the routing benefit is domain-dependent. Full training logs and manifests attached.',
  sections: [
    { heading: 'Setup', body: 'Identical architecture and hyperparameters to the original, swapping the training corpus for permissively-licensed source code. Toolchain pinned: Python 3.11.6, PyTorch 2.3.1.', order: 1 },
    { heading: 'Findings', body: 'Perplexity curves for SAR and dense attention are statistically indistinguishable on code (3 seeds, 95% CI). The original English-text result reproduces cleanly, ruling out implementation error.', order: 2 },
  ],
  references: [{ label: '[1]', raw: 'Chen & Quasar. Sparse Attention Routing Improves Sample Efficiency in Small Language Models. Beyond Papers, 2026.' }],
  license: 'platform-cc-by-sa',
  created_by: bob,
  authors: [{ user_id: bob, position: 1, credit_roles: ['investigation', 'validation', 'writing_original_draft'] }],
});
insertEdge.run(bobReplication.id, alicePaper.id, 'fails_to_replicate', bob, 'Replication on code models: no sample-efficiency gain (3 seeds, CI includes zero); original text-domain result reproduces.', bob);
log(`bob negative replication: work ${bobReplication.id} + fails_to_replicate edge`);

// Communal concept node (§12.4).
const concept = createWork({
  kind: 'concept',
  editing: 'communal',
  title: 'In-context learning',
  abstract:
    'The ability of a language model to adapt its behavior from examples given in the prompt, without weight updates. This communal concept node connects work that shares the idea rather than a citation — anyone can edit it, wiki-style, with full version history.',
  license: 'platform-cc-by-sa',
  created_by: alice,
});
log(`concept node: work ${concept.id}`);

// Dataset node (§7.1/§7.3 — by-reference artifact).
const dataset = createWork({
  kind: 'dataset',
  editing: 'authored',
  title: 'SAR Training Logs and Ablation Grid (60M-410M)',
  abstract:
    'Complete training logs, seeds, and ablation grid for the SAR experiments. Hosted externally by reference (12 GB); license CC0. Includes the execution manifest: exact package versions and run dates for every curve.',
  license: 'cc0',
  created_by: alice,
  authors: [{ user_id: alice, position: 1, credit_roles: ['data_curation'] }],
});
insertEdge.run(dataset.id, alicePaper.id, 'provides_data_for', alice, 'Primary data for all figures.', alice);
log(`dataset node: work ${dataset.id}`);

// Typed edges into the imported metadata graph (§2.1).
const someImported = [...openalexIdToWorkId.values()];
if (someImported.length >= 2) {
  insertEdge.run(alicePaper.id, someImported[0], 'extends', alice, 'Builds directly on the attention architecture introduced there.', alice);
  insertEdge.run(alicePaper.id, someImported[1], 'uses_method_of', alice, 'Reuses the evaluation protocol.', alice);
  log('typed edges into imported graph: extends, uses_method_of');
}

// Review as a first-class work (§5.1) + reviews edge.
const review = createWork({
  kind: 'review',
  editing: 'authored',
  title: 'Review of "Sparse Attention Routing Improves Sample Efficiency in Small Language Models"',
  abstract:
    'A careful and unusually reproducible paper. Strengths: pinned toolchain manifest, released negative ablations, clear limitations section. Weaknesses: English-only evaluation; the low-data regime claim would benefit from a third seed. Recommendation: endorse, with the domain-transfer caveat now confirmed by an independent replication.',
  license: 'platform-cc-by-sa',
  created_by: bob,
  authors: [{ user_id: bob, position: 1, credit_roles: ['writing_review_editing'] }],
});
insertEdge.run(review.id, alicePaper.id, 'reviews', bob, 'Open post-publication review (§5.2).', bob);
log(`review: work ${review.id}`);

// ---------- 4. AI layer demo (heuristic provider — zero cost) ----------

process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? 'heuristic';
try {
  const provider = getAiProvider();
  const detail = getWorkDetail(alicePaper.id)!;
  const summary = await provider.summarize(detail, 'full'); // tier C — full text allowed (§4.3)
  db.prepare(
    `INSERT INTO ai_outputs (work_id, feature, content, model, model_version, status) VALUES (?, 'summary', ?, 'heuristic-tfidf', '1.0', 'active')`,
  ).run(alicePaper.id, summary);
  log('AI summary generated (heuristic)');
} catch (err) {
  log(`AI provider unavailable, inserting canned summary: ${(err as Error).message}`);
  db.prepare(
    `INSERT INTO ai_outputs (work_id, feature, content, model, model_version, status) VALUES (?, 'summary', ?, 'heuristic-tfidf', '1.0', 'active')`,
  ).run(
    alicePaper.id,
    'This paper proposes routing each token to a subset of attention heads, cutting attention compute by about a third while improving sample efficiency 12-18% on small language models.',
  );
}

// AI-SUGGESTED edges (§4.1): distinct class, status='suggested', never authoritative until confirmed (§4.2).
const insertAiEdge = db.prepare(
  `INSERT OR IGNORE INTO edges (source_work_id, target_work_id, type, origin, model, model_version, confidence, basis, status)
   VALUES (?, ?, ?, 'ai', 'heuristic-tfidf', '1.0', ?, ?, 'suggested')`,
);
if (someImported.length >= 4) {
  insertAiEdge.run(alicePaper.id, someImported[2], 'cites', 0.42, 'TF-IDF cosine similarity: 0.42');
  insertAiEdge.run(bobReplication.id, someImported[3], 'cites', 0.31, 'TF-IDF cosine similarity: 0.31');
  insertAiEdge.run(concept.id, someImported[0], 'cites', 0.27, 'TF-IDF cosine similarity: 0.27');
  log('AI-suggested edges inserted (status=suggested)');
}

// ---------- 5. Community activity: comments, votes, flags ----------

const firstSubunit = db.prepare('SELECT id FROM subunits WHERE work_id = ? ORDER BY order_index LIMIT 1').get(alicePaper.id) as { id: number } | undefined;
const insertComment = db.prepare(
  `INSERT INTO comments (work_id, subunit_id, parent_id, author_user_id, body) VALUES (?, ?, ?, ?, ?)`,
);
const c1 = insertComment.run(alicePaper.id, null, null, bob, 'The pinned toolchain manifest made this trivial to re-run. More of this, please.');
insertComment.run(alicePaper.id, null, Number(c1.lastInsertRowid), alice, 'Thanks — the manifest is auto-captured from the environment at run time.');
if (firstSubunit) {
  insertComment.run(alicePaper.id, firstSubunit.id, null, quasar, 'H1 might be better stated as head redundancy rather than specialization — the routing evidence supports either reading.');
}
log('comments: 3 (one subunit-anchored)');

const failsEdge = db.prepare(`SELECT id FROM edges WHERE type = 'fails_to_replicate' LIMIT 1`).get() as { id: number } | undefined;
if (failsEdge) {
  db.prepare(`INSERT INTO edge_votes (edge_id, user_id, vote, comment) VALUES (?, ?, 1, 'Three seeds and CIs — solid negative evidence.')`).run(failsEdge.id, quasar);
  db.prepare(`INSERT INTO edge_votes (edge_id, user_id, vote, comment) VALUES (?, ?, 1, NULL)`).run(failsEdge.id, alice);
  log('edge votes on the contested fails_to_replicate edge');
}

// Flags (§4.5): one resolved-upheld (feeds the public track record) + one open.
const aiSummaryRow = db.prepare(`SELECT id FROM ai_outputs WHERE feature = 'summary' LIMIT 1`).get() as { id: number } | undefined;
if (aiSummaryRow) {
  const f1 = db
    .prepare(`INSERT INTO flags (target_type, target_id, reporter_user_id, reason, status, resolved_by, resolved_at, resolution_note)
              VALUES ('ai_output', ?, ?, 'Summary overstated the FLOP reduction as "half" in an earlier generation.', 'upheld', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'Regenerated; corrected figure is one third.')`)
    .run(aiSummaryRow.id, bob, admin);
  void f1;
  const aiEdge = db.prepare(`SELECT id FROM edges WHERE origin = 'ai' AND status = 'suggested' LIMIT 1`).get() as { id: number } | undefined;
  if (aiEdge) {
    db.prepare(`INSERT INTO flags (target_type, target_id, reporter_user_id, reason) VALUES ('edge', ?, ?, 'Suggested connection looks topically unrelated to me.')`).run(aiEdge.id, quasar);
  }
  log('flags: 1 upheld (track record), 1 open (moderation queue)');
}

// ---------- Summary ----------

const counts = {
  users: (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c,
  works: (db.prepare('SELECT COUNT(*) c FROM works').get() as { c: number }).c,
  versions: (db.prepare('SELECT COUNT(*) c FROM work_versions').get() as { c: number }).c,
  subunits: (db.prepare('SELECT COUNT(*) c FROM subunits').get() as { c: number }).c,
  edges: (db.prepare('SELECT COUNT(*) c FROM edges').get() as { c: number }).c,
  ai_suggested_edges: (db.prepare(`SELECT COUNT(*) c FROM edges WHERE origin='ai' AND status='suggested'`).get() as { c: number }).c,
  comments: (db.prepare('SELECT COUNT(*) c FROM comments').get() as { c: number }).c,
  ai_outputs: (db.prepare('SELECT COUNT(*) c FROM ai_outputs').get() as { c: number }).c,
  flags: (db.prepare('SELECT COUNT(*) c FROM flags').get() as { c: number }).c,
};
log(`done: ${JSON.stringify(counts)}`);
log('demo logins → admin / admin-demo-2026 (admin), achen / demo-password, bkumar / demo-password, quasar / demo-password');
