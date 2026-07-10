// End-to-end API test harness. Spawns the server against a throwaway DB,
// exercises the spec §18 QA checklist over real HTTP, reports pass/fail.
// Run: npm run test:api

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3777;
const BASE = `http://localhost:${PORT}`;
const tmp = mkdtempSync(path.join(tmpdir(), 'bp-test-'));
const dbPath = path.join(tmp, 'test.db');

let server: ChildProcess | null = null;
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Ctx { token?: string }
async function req(method: string, p: string, body?: unknown, ctx?: Ctx): Promise<{ status: number; json: any; text: string }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (ctx?.token) headers['Authorization'] = `Bearer ${ctx.token}`;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON (exports) */ }
  return { status: res.status, json, text };
}

async function waitForServer(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not start in time');
}

async function main() {
  console.log('Starting server on temp DB…');
  server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, AI_PROVIDER: 'heuristic', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await waitForServer();

  // ---------- auth ----------
  console.log('\nAuth:');
  const reg = await req('POST', '/api/auth/register', { username: 'tester', password: 'password123', display_name: 'Tester' });
  check('register 201 + session_token + user', reg.status === 201 && !!reg.json?.session_token && reg.json?.user?.username === 'tester');
  const t1: Ctx = { token: reg.json?.session_token };
  const dup = await req('POST', '/api/auth/register', { username: 'tester', password: 'password123', display_name: 'X' });
  check('duplicate username 409', dup.status === 409);
  const badLogin = await req('POST', '/api/auth/login', { username: 'tester', password: 'wrong' });
  check('bad login 401', badLogin.status === 401);
  const me = await req('GET', '/api/auth/me', undefined, t1);
  check('me returns user, no password_hash', me.status === 200 && me.json?.user && !('password_hash' in me.json.user));
  const reg2 = await req('POST', '/api/auth/register', { username: 'other', password: 'password123', display_name: 'Other', is_pseudonym: true });
  const t2: Ctx = { token: reg2.json?.session_token };

  // ---------- licensing boundary ----------
  console.log('\nLicensing boundary (§3):');
  const closedWork = await req('POST', '/api/works', { kind: 'paper', title: 'Closed work', abstract: 'x', license: 'closed', sections: [], references: [] }, t1);
  check('closed license → tier A', closedWork.status === 201 && closedWork.json?.work?.tier === 'A', `got ${closedWork.status} tier ${closedWork.json?.work?.tier}`);
  const aId = closedWork.json?.work?.id;
  const suA = await req('POST', `/api/works/${aId}/subunits`, { type: 'claim', content: 'nope' }, t1);
  check('tier A subunit → 403 LICENSE_GATE', suA.status === 403 && suA.json?.error?.code === 'LICENSE_GATE', `got ${suA.status} ${suA.json?.error?.code}`);
  const secA = await req('POST', '/api/works', { kind: 'paper', title: 'A with sections', license: 'unknown', sections: [{ heading: 'S', body: 'b', order: 1 }], references: [] }, t1);
  check('tier A with sections → 422 LICENSE_GATE', secA.status === 422 && secA.json?.error?.code === 'LICENSE_GATE', `got ${secA.status} ${secA.json?.error?.code}`);
  const ndWork = await req('POST', '/api/works', { kind: 'paper', title: 'ND hosted whole', abstract: 'x', license: 'cc-by-nd', sections: [{ heading: 'Body', body: 'full text ok', order: 1 }], references: [] }, t1);
  check('cc-by-nd → tier B, sections stored', ndWork.status === 201 && ndWork.json?.work?.tier === 'B');
  const suB = await req('POST', `/api/works/${ndWork.json?.work?.id}/subunits`, { type: 'claim', content: 'nope' }, t1);
  check('tier B subunit → 403', suB.status === 403);
  const cWork = await req('POST', '/api/works', {
    kind: 'paper', title: 'Open tier C work about sparse attention routing efficiency', abstract: 'Sparse attention routing improves sample efficiency in language models.',
    license: 'cc-by', sections: [{ heading: 'Intro', body: 'Attention is costly. Routing tokens to fewer heads preserves quality. This is the key finding of the work.', order: 1 }], references: [],
  }, t1);
  check('cc-by → tier C', cWork.status === 201 && cWork.json?.work?.tier === 'C');
  const cId = cWork.json?.work?.id;
  const suC = await req('POST', `/api/works/${cId}/subunits`, { type: 'hypothesis', title: 'H1', content: 'Heads are redundant.' }, t1);
  check('tier C subunit created', suC.status === 201 && !!suC.json?.subunit?.content_hash);
  const downgrade = await req('PATCH', `/api/works/${cId}`, { change_note: 'downgrade', license: 'cc-by-nc' }, t1);
  check('license downgrade with subunits → 409', downgrade.status === 409, `got ${downgrade.status}`);

  // ---------- immutability & versions ----------
  console.log('\nImmutability (§1.3):');
  const before = await req('GET', `/api/works/${cId}`);
  const hash1 = before.json?.work?.current_version?.content_hash;
  const patch = await req('PATCH', `/api/works/${cId}`, { change_note: 'tweak abstract', abstract: 'Updated abstract about routing.' }, t1);
  check('PATCH creates new version', patch.status === 200 && patch.json?.work?.current_version?.version_number === 2, `got vnum ${patch.json?.work?.current_version?.version_number}`);
  const hash2 = patch.json?.work?.current_version?.content_hash;
  check('content hash changed', !!hash1 && !!hash2 && hash1 !== hash2);
  const versions = await req('GET', `/api/works/${cId}/versions`);
  check('versions list has 2', versions.json?.items?.length === 2 || versions.json?.total === 2);
  const v1id = versions.json?.items?.find((v: any) => v.version_number === 1)?.id;
  const revert = await req('POST', `/api/works/${cId}/revert`, { version_id: v1id }, t1);
  check('revert reproduces old hash in new version', revert.status === 201 && revert.json?.work?.current_version?.content_hash === hash1 && revert.json?.work?.current_version?.version_number === 3,
    `got ${revert.status} vnum ${revert.json?.work?.current_version?.version_number}`);
  const byHash = await req('GET', `/api/versions/${hash1}`);
  check('versions/:hash resolves (2 matches after revert)', byHash.status === 200 && byHash.json?.matches?.length === 2, `got ${byHash.json?.matches?.length}`);

  // ---------- authored vs communal (§12.3) ----------
  console.log('\nEditing modes (§12.3):');
  const editByOther = await req('PATCH', `/api/works/${cId}`, { change_note: 'hostile edit', title: 'Hacked' }, t2);
  check('non-author edit of authored work → 403', editByOther.status === 403);
  const concept = await req('POST', '/api/works', { kind: 'concept', title: 'In-context learning', abstract: 'Concept node.', license: 'platform-cc-by-sa', editing: 'authored' }, t1);
  check('concept forced communal', concept.status === 201 && concept.json?.work?.editing === 'communal');
  const communalEdit = await req('PATCH', `/api/works/${concept.json?.work?.id}`, { change_note: 'improve definition', abstract: 'Better definition.' }, t2);
  check('anyone can edit communal node', communalEdit.status === 200);

  // ---------- edges (§2, §4.2) ----------
  console.log('\nEdges & AI trust boundary (§4):');
  const humanEdge = await req('POST', '/api/edges', { source_work_id: cId, target_work_id: aId, type: 'extends', basis: 'test' }, t1);
  check('human edge → confirmed immediately', humanEdge.status === 201 && humanEdge.json?.edge?.status === 'confirmed' && humanEdge.json?.edge?.origin === 'human');
  const dupEdge = await req('POST', '/api/edges', { source_work_id: cId, target_work_id: aId, type: 'extends' }, t2);
  check('duplicate edge triple → 409', dupEdge.status === 409, `got ${dupEdge.status}`);
  const selfEdge = await req('POST', '/api/edges', { source_work_id: cId, target_work_id: cId, type: 'cites' }, t1);
  check('self-loop → 400', selfEdge.status === 400);
  const suggest = await req('POST', `/api/works/${cId}/ai/suggest-edges`, undefined, t1);
  check('AI suggest-edges 201', suggest.status === 201, `got ${suggest.status}: ${JSON.stringify(suggest.json)?.slice(0, 200)}`);
  const aiEdges: any[] = suggest.json?.items ?? [];
  check('all AI edges suggested + provenance', aiEdges.length === 0 || aiEdges.every((e) => e.status === 'suggested' && e.origin === 'ai' && e.model && e.confidence !== null));
  const graphDefault = await req('GET', `/api/graph/${cId}?depth=2`);
  const suggestedInDefault = (graphDefault.json?.edges ?? []).filter((e: any) => e.origin === 'ai' && e.status === 'suggested');
  check('graph default excludes suggested AI edges', graphDefault.status === 200 && suggestedInDefault.length === 0);
  const graphAi = await req('GET', `/api/graph/${cId}?depth=2&include_ai=true`);
  const suggestedInAi = (graphAi.json?.edges ?? []).filter((e: any) => e.origin === 'ai' && e.status === 'suggested');
  check('graph include_ai includes them (when any exist)', graphAi.status === 200 && (aiEdges.length === 0 || suggestedInAi.length > 0));
  if (aiEdges.length > 0) {
    const confirm = await req('POST', `/api/edges/${aiEdges[0].id}/confirm`, undefined, t2);
    check('AI edge promotable by human (§4.2)', confirm.status === 200 && confirm.json?.edge?.status === 'confirmed' && !!confirm.json?.edge?.confirmed_by);
    const reconfirm = await req('POST', `/api/edges/${aiEdges[0].id}/confirm`, undefined, t2);
    check('confirm→confirm invalid transition 422', reconfirm.status === 422);
  }
  const vote = await req('POST', `/api/edges/${humanEdge.json?.edge?.id}/vote`, { vote: -1, comment: 'disagree' }, t2);
  check('edge vote works', vote.status === 200 && vote.json?.edge?.votes?.down === 1);
  const dispute = await req('POST', `/api/edges/${humanEdge.json?.edge?.id}/dispute`, { comment: 'contested' }, t2);
  check('confirmed → disputed', dispute.status === 200 && dispute.json?.edge?.status === 'disputed');

  // ---------- reviews & comments (§5) ----------
  console.log('\nReviews & comments (§5):');
  const rev = await req('POST', `/api/works/${cId}/reviews`, { title: 'Review of routing work', abstract: 'Solid.', license: 'platform-cc-by-sa' }, t2);
  check('review created as work + edge', rev.status === 201 && rev.json?.review?.kind === 'review' && rev.json?.edge?.type === 'reviews');
  const revList = await req('GET', `/api/works/${cId}/reviews`);
  check('reviews listed on target', (revList.json?.items?.length ?? 0) >= 1);
  const com = await req('POST', `/api/works/${cId}/comments`, { body: 'Nice work.' }, t2);
  check('comment created', com.status === 201 && !!com.json?.comment?.id);
  const subCom = await req('POST', `/api/works/${cId}/comments`, { body: 'On the hypothesis specifically.', subunit_id: suC.json?.subunit?.id }, t2);
  check('subunit-anchored comment (§5.4)', subCom.status === 201 && subCom.json?.comment?.subunit_id === suC.json?.subunit?.id);
  const reply = await req('POST', `/api/works/${cId}/comments`, { body: 'Agreed.', parent_id: com.json?.comment?.id }, t1);
  check('threaded reply', reply.status === 201 && reply.json?.comment?.parent_id === com.json?.comment?.id);

  // ---------- AI outputs & flags (§4.3–4.5) ----------
  console.log('\nAI outputs & flags (§4.3–4.5):');
  const sum = await req('POST', `/api/works/${cId}/ai/summarize`, undefined, t1);
  check('AI summary created with provenance', sum.status === 201 && !!sum.json?.output?.model && sum.json?.output?.feature === 'summary');
  const edit = await req('PATCH', `/api/ai/${sum.json?.output?.id}`, { content: 'Human-corrected summary.' }, t2);
  check('AI output human-editable, tracked (§4.4)', edit.status === 200 && edit.json?.output?.edited_by != null && edit.json?.output?.previous_output_id === sum.json?.output?.id);
  const flag = await req('POST', '/api/flags', { target_type: 'ai_output', target_id: edit.json?.output?.id, reason: 'Inaccurate claim.' }, t1);
  check('flagging AI output', flag.status === 201 && flag.json?.flag?.status === 'open');
  const listFlagsNonAdmin = await req('GET', '/api/flags', undefined, t1);
  check('flag queue admin-only 403', listFlagsNonAdmin.status === 403);
  // Promote tester to admin directly in the DB (no HTTP path to admin by design).
  const Database = (await import('better-sqlite3')).default;
  const rawDb = new Database(dbPath);
  rawDb.prepare(`UPDATE users SET is_admin = 1 WHERE username = 'tester'`).run();
  rawDb.close();
  const listFlagsAdmin = await req('GET', '/api/flags?status=open', undefined, t1);
  check('admin sees open flags', listFlagsAdmin.status === 200 && (listFlagsAdmin.json?.items?.length ?? 0) >= 1);
  const resolve = await req('POST', `/api/flags/${flag.json?.flag?.id}/resolve`, { status: 'upheld', action: 'remove', resolution_note: 'Confirmed inaccurate.' }, t1);
  check('resolve upheld+remove', resolve.status === 200 && resolve.json?.flag?.status === 'upheld');
  const aiAfter = await req('GET', `/api/works/${cId}/ai`);
  const removedGone = !(aiAfter.json?.items ?? []).some((o: any) => o.id === edit.json?.output?.id);
  check('removed AI output not served', removedGone);
  const track = await req('GET', '/api/ai/track-record');
  check('track record public + has upheld', track.status === 200 && (track.json?.items ?? []).some((r: any) => r.upheld >= 1));

  // ---------- search & ranking (§8) ----------
  console.log('\nSearch & ranking (§8):');
  const search = await req('GET', '/api/search?q=routing');
  check('search returns score breakdown + weights', search.status === 200 && !!search.json?.weights && (search.json?.items ?? []).every((i: any) => i.score_components && i.score >= 0));
  const badDepth = await req('GET', `/api/graph/${cId}?depth=4`);
  check('graph depth=4 → 400', badDepth.status === 400);

  // ---------- export (§1.5) ----------
  console.log('\nExport (§1.5):');
  const latex = await req('GET', `/api/works/${cId}/export/latex`);
  check('LaTeX export', latex.status === 200 && latex.text.includes('\\documentclass') && latex.text.includes('\\begin{abstract}'));
  const latexA = await req('GET', `/api/works/${aId}/export/latex`);
  check('LaTeX export works for tier-A stub', latexA.status === 200 && latexA.text.includes('\\documentclass'));
  const bib = await req('GET', `/api/works/${cId}/export/bibtex`);
  check('BibTeX export', bib.status === 200 && bib.text.trimStart().startsWith('@'));
  const cjson = await req('GET', `/api/works/${cId}/export/json`);
  check('JSON export with beyond-papers ext', cjson.status === 200 && !!cjson.json?.['beyond-papers']?.current_version_hash);

  // ---------- summary ----------
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
}

main()
  .catch((err) => {
    console.error('HARNESS ERROR:', err);
    failed++;
  })
  .finally(() => {
    server?.kill();
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows file locks */ }
    process.exit(failed > 0 ? 1 : 0);
  });
