// Work detail — the composite node rendered like a paper (§1.1).
// Two-column layout: article column (title, authors, abstract, sections,
// sub-units, references, export/action bars) + right rail (connections,
// reviews, AI panel). Comments run full-width beneath both.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AiOutput, Comment, EdgeDetail, SubunitType, WorkChat, WorkDetail, WorkSummary } from '@shared/types';
import { SUBUNIT_TYPES } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';
import { KindBadge, PublicationStatusBadge, ResultBadge, TierBadge } from '../components/Badges';
import AiPanel from '../components/work/AiPanel';
import CommentThread from '../components/work/CommentThread';
import EdgePanel from '../components/work/EdgePanel';
import SubunitBlock from '../components/work/SubunitBlock';

function errMsg(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.';
}

export default function WorkPage() {
  const { id } = useParams<{ id: string }>();
  const workId = Number(id);
  const { user } = useAuth();

  const [work, setWork] = useState<WorkDetail | null>(null);
  const [workLoading, setWorkLoading] = useState(true);
  const [workError, setWorkError] = useState<string | null>(null);

  const [edges, setEdges] = useState<EdgeDetail[]>([]);
  const [edgesLoading, setEdgesLoading] = useState(true);
  const [edgesError, setEdgesError] = useState<string | null>(null);

  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  const [reviews, setReviews] = useState<WorkSummary[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState<string | null>(null);

  const [aiOutputs, setAiOutputs] = useState<AiOutput[]>([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState<string | null>(null);

  const [chats, setChats] = useState<WorkChat[]>([]);
  const [chatsLoading, setChatsLoading] = useState(true);

  const loadWork = useCallback(async () => {
    setWorkLoading(true);
    setWorkError(null);
    try {
      const res = await api.get<{ work: WorkDetail }>(`/api/works/${workId}`);
      setWork(res.work);
    } catch (err) {
      setWorkError(errMsg(err));
    } finally {
      setWorkLoading(false);
    }
  }, [workId]);

  const loadEdges = useCallback(async () => {
    setEdgesLoading(true);
    setEdgesError(null);
    try {
      const res = await api.get<{ items: EdgeDetail[] }>(`/api/works/${workId}/edges?include_ai=true`);
      setEdges(res.items);
    } catch (err) {
      setEdgesError(errMsg(err));
    } finally {
      setEdgesLoading(false);
    }
  }, [workId]);

  const loadComments = useCallback(async () => {
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const res = await api.get<{ items: Comment[] }>(`/api/works/${workId}/comments`);
      setComments(res.items);
    } catch (err) {
      setCommentsError(errMsg(err));
    } finally {
      setCommentsLoading(false);
    }
  }, [workId]);

  const loadReviews = useCallback(async () => {
    setReviewsLoading(true);
    setReviewsError(null);
    try {
      const res = await api.get<{ items: WorkSummary[]; total: number }>(`/api/works/${workId}/reviews`);
      setReviews(res.items);
    } catch (err) {
      setReviewsError(errMsg(err));
    } finally {
      setReviewsLoading(false);
    }
  }, [workId]);

  const loadAi = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await api.get<{ items: AiOutput[] }>(`/api/works/${workId}/ai`);
      setAiOutputs(res.items);
    } catch (err) {
      setAiError(errMsg(err));
    } finally {
      setAiLoading(false);
    }
  }, [workId]);

  const loadChats = useCallback(async () => {
    setChatsLoading(true);
    try {
      const res = await api.get<{ items: WorkChat[] }>(`/api/works/${workId}/chats`);
      setChats(res.items);
    } catch {
      setChats([]); // non-critical rail content — fail quiet
    } finally {
      setChatsLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void loadWork();
    void loadEdges();
    void loadComments();
    void loadReviews();
    void loadAi();
    void loadChats();
  }, [loadWork, loadEdges, loadComments, loadReviews, loadAi, loadChats]);

  // Sub-unit mini-form (Tier C only)
  const [subType, setSubType] = useState<SubunitType>(SUBUNIT_TYPES[0]);
  const [subTitle, setSubTitle] = useState('');
  const [subContent, setSubContent] = useState('');
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

  async function submitSubunit(e: FormEvent) {
    e.preventDefault();
    if (!subContent.trim()) return;
    setSubBusy(true);
    setSubError(null);
    try {
      await api.post(`/api/works/${workId}/subunits`, {
        type: subType,
        title: subTitle.trim() || undefined,
        content: subContent.trim(),
      });
      setSubTitle('');
      setSubContent('');
      await loadWork();
    } catch (err) {
      setSubError(errMsg(err));
    } finally {
      setSubBusy(false);
    }
  }

  const [copied, setCopied] = useState(false);
  async function copyHash(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — not fatal, just skip the confirmation.
    }
  }

  if (!id || Number.isNaN(workId)) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Invalid work</p>
      </div>
    );
  }

  if (workLoading) {
    return (
      <div className="stack gap-4">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-text" />
        <div className="skeleton skeleton-text" style={{ width: '80%' }} />
        <div className="skeleton skeleton-text" style={{ width: '60%' }} />
      </div>
    );
  }

  if (workError) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Couldn&rsquo;t load this work</p>
        <p className="empty-state-body">{workError}</p>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => void loadWork()}>
          Retry
        </button>
      </div>
    );
  }

  if (!work) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Work not found</p>
      </div>
    );
  }

  const canEdit =
    !!user &&
    (work.editing === 'communal' || work.created_by === user.id || work.authors.some((a) => a.user_id === user.id));

  const version = work.current_version;
  const abstract = version?.content.abstract ?? work.abstract ?? '';
  const sections = version ? [...version.content.sections].sort((a, b) => a.order - b.order) : [];
  const references = version?.content.references ?? [];
  const sortedAuthors = [...work.authors].sort((a, b) => a.position - b.position);
  const sortedSubunits = [...work.subunits].sort((a, b) => a.order_index - b.order_index);

  return (
    <div className="stack gap-8">
      <div className="flex flex-wrap gap-6" style={{ alignItems: 'flex-start' }}>
        {/* ---------------- Article column ---------------- */}
        <div style={{ flex: '3 1 480px', minWidth: 0 }}>
          <div className="row flex-wrap gap-2" data-print-hide>
            <TierBadge tier={work.tier} license={work.license} />
            <KindBadge kind={work.kind} />
            <PublicationStatusBadge status={work.publication_status} />
            <ResultBadge nature={work.result_nature} />
            {work.editing === 'communal' ? <span className="badge">Communal</span> : null}
            {work.url ? (
              <a href={work.url} target="_blank" rel="noreferrer" className="small">
                {work.site_name ?? (() => { try { return new URL(work.url).hostname.replace(/^www\./, ''); } catch { return work.url; } })()} ↗
              </a>
            ) : null}
          </div>

          <h1 style={{ marginTop: 'var(--space-3)' }}>{work.title}</h1>

          <p className="card-authors" style={{ marginTop: 'var(--space-2)' }}>
            {sortedAuthors.length === 0 ? (
              <span className="muted">Unknown authors</span>
            ) : (
              sortedAuthors.map((a, i) => (
                <span key={`${a.position}-${i}`}>
                  {i > 0 ? '; ' : ''}
                  {a.user_id ? <Link to={`/users/${a.user_id}`}>{a.name}</Link> : <span>{a.name}</span>}
                  {a.orcid ? (
                    <>
                      {' '}
                      <a href={`https://orcid.org/${a.orcid}`} target="_blank" rel="noreferrer" className="small muted">
                        {a.orcid}
                      </a>
                    </>
                  ) : null}
                  {a.credit_roles.length > 0 ? (
                    <span className="small muted"> ({a.credit_roles.map((r) => r.replace(/_/g, ' ')).join(', ')})</span>
                  ) : null}
                </span>
              ))
            )}
          </p>

          <div className="article-body" style={{ marginTop: 'var(--space-6)' }}>
            <h2>Abstract</h2>
            <p>{abstract || 'No abstract available.'}</p>

            {work.tier === 'A' ? (
              <div className="empty-state">
                <p className="empty-state-title">Metadata-only record (Tier A license)</p>
                <p className="empty-state-body">
                  This license does not permit hosting the full text here — read it at the publisher.{' '}
                  {work.doi ? (
                    <a href={`https://doi.org/${work.doi}`} target="_blank" rel="noreferrer">
                      doi:{work.doi}
                    </a>
                  ) : null}
                  {work.arxiv_id ? (
                    <a href={`https://arxiv.org/abs/${work.arxiv_id}`} target="_blank" rel="noreferrer">
                      arXiv:{work.arxiv_id}
                    </a>
                  ) : null}
                  {work.url && !work.doi && !work.arxiv_id ? (
                    <a href={work.url} target="_blank" rel="noreferrer">
                      Read at {work.site_name ?? 'the source'}
                    </a>
                  ) : null}
                </p>
              </div>
            ) : (
              sections.map((s) => (
                <section key={s.order}>
                  <h2>{s.heading}</h2>
                  {s.body
                    .split(/\n{2,}/)
                    .filter((p) => p.trim().length > 0)
                    .map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                </section>
              ))
            )}

            {sortedSubunits.length > 0 ? (
              <>
                <h2>Sub-units</h2>
                <div className="stack gap-3" style={{ fontFamily: 'var(--font-ui)' }}>
                  {sortedSubunits.map((su) => (
                    <SubunitBlock
                      key={su.id}
                      subunit={su}
                      commentCount={comments.filter((c) => c.subunit_id === su.id).length}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {references.length > 0 ? (
              <>
                <h2>References</h2>
                <ol style={{ listStyle: 'decimal', paddingLeft: 'var(--space-6)' }}>
                  {references.map((r, i) => (
                    <li key={i} style={{ marginBottom: 'var(--space-2)' }}>
                      <strong>{r.label}</strong> {r.raw}
                      {r.doi ? (
                        <>
                          {' '}
                          <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">
                            doi:{r.doi}
                          </a>
                        </>
                      ) : r.url ? (
                        <>
                          {' '}
                          <a href={r.url} target="_blank" rel="noreferrer">
                            {r.url}
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
          </div>

          {/* ---------------- Export bar ---------------- */}
          <div className="stack gap-2" style={{ marginTop: 'var(--space-6)' }} data-print-hide>
            <div className="row flex-wrap gap-2">
              {work.url ? (
                <a className="btn btn-ghost btn-sm" href={work.url} target="_blank" rel="noreferrer">
                  Read at {work.site_name ?? 'source'} ↗
                </a>
              ) : null}
              <a className="btn btn-ghost btn-sm" href={`/api/works/${work.id}/export/latex`}>
                LaTeX
              </a>
              <a className="btn btn-ghost btn-sm" href={`/api/works/${work.id}/export/bibtex`}>
                BibTeX
              </a>
              <a className="btn btn-ghost btn-sm" href={`/api/works/${work.id}/export/json`}>
                JSON
              </a>
            </div>
            {version ? (
              <div className="row flex-wrap gap-2 items-center small muted">
                <span>Cite frozen version:</span>
                <code>{version.content_hash.slice(0, 16)}</code>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => void copyHash(version.content_hash)}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <Link to={`/versions/${version.content_hash}`}>View</Link>
              </div>
            ) : null}
          </div>

          {/* ---------------- Action bar ---------------- */}
          <div className="row flex-wrap gap-2" style={{ marginTop: 'var(--space-4)' }} data-print-hide>
            {canEdit ? (
              <Link className="btn btn-ghost btn-sm" to={`/works/${work.id}/edit`}>
                Edit
              </Link>
            ) : null}
            <Link className="btn btn-ghost btn-sm" to={`/works/${work.id}/versions`}>
              History
            </Link>
            <Link className="btn btn-ghost btn-sm" to={`/works/${work.id}/graph`}>
              Graph
            </Link>
            {user ? (
              <Link className="btn btn-ghost btn-sm" to={`/works/${work.id}/review`}>
                Write review
              </Link>
            ) : (
              <Link className="btn btn-ghost btn-sm" to="/login">
                Log in to write a review
              </Link>
            )}
          </div>

          {/* ---------------- Add sub-unit ---------------- */}
          <div className="stack gap-2" style={{ marginTop: 'var(--space-5)' }} data-print-hide>
            <h3 style={{ fontSize: 'var(--font-size-md)' }}>Add a sub-unit</h3>
            {work.tier !== 'C' ? (
              <p className="small muted">
                Sub-units unavailable: license tier {work.tier} does not permit decomposition (§3).
              </p>
            ) : !user ? (
              <p className="small muted">
                <Link to="/login">Log in</Link> to add a sub-unit.
              </p>
            ) : !canEdit ? (
              <p className="small muted">You need edit permission on this work to add sub-units.</p>
            ) : (
              <form className="stack gap-2" onSubmit={(e) => void submitSubunit(e)} aria-label="Add a sub-unit">
                <div className="field">
                  <label htmlFor="subunit-type">Type</label>
                  <select id="subunit-type" value={subType} onChange={(e) => setSubType(e.target.value as SubunitType)}>
                    {SUBUNIT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="subunit-title">Title (optional)</label>
                  <input id="subunit-title" type="text" value={subTitle} onChange={(e) => setSubTitle(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="subunit-content">Content</label>
                  <textarea
                    id="subunit-content"
                    value={subContent}
                    onChange={(e) => setSubContent(e.target.value)}
                    required
                  />
                </div>
                {subError ? (
                  <p className="small" style={{ color: 'var(--color-danger)' }}>
                    {subError}
                  </p>
                ) : null}
                <button className="btn btn-primary btn-sm" type="submit" disabled={subBusy} style={{ alignSelf: 'flex-start' }}>
                  {subBusy ? 'Adding…' : 'Add sub-unit'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* ---------------- Right rail ---------------- */}
        <aside style={{ flex: '1 1 300px', minWidth: 280 }} className="stack gap-6">
          <div>
            {edgesLoading ? (
              <div className="stack gap-2">
                <div className="skeleton skeleton-title" />
                <div className="skeleton skeleton-text" />
                <div className="skeleton skeleton-text" style={{ width: '70%' }} />
              </div>
            ) : edgesError ? (
              <div className="empty-state">
                <p className="empty-state-title">Couldn&rsquo;t load connections</p>
                <p className="empty-state-body">{edgesError}</p>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => void loadEdges()}>
                  Retry
                </button>
              </div>
            ) : (
              <EdgePanel workId={work.id} edges={edges} onChange={() => void loadEdges()} />
            )}
          </div>

          <div className="stack gap-3">
            <h2 style={{ fontSize: 'var(--font-size-lg)' }}>Reviews</h2>
            {reviewsLoading ? (
              <div className="stack gap-2">
                <div className="skeleton skeleton-text" />
                <div className="skeleton skeleton-text" style={{ width: '70%' }} />
              </div>
            ) : reviewsError ? (
              <div className="empty-state">
                <p className="empty-state-title">Couldn&rsquo;t load reviews</p>
                <p className="empty-state-body">{reviewsError}</p>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => void loadReviews()}>
                  Retry
                </button>
              </div>
            ) : reviews.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state-title">No reviews yet</p>
                <p className="empty-state-body">Be the first to review this work.</p>
              </div>
            ) : (
              <div className="stack gap-3">
                {reviews.map((r) => (
                  <article className="review-card" key={r.id}>
                    <header className="review-card-head">
                      <Link to={`/works/${r.id}`} style={{ fontWeight: 'var(--font-weight-semibold)' }}>
                        {r.title}
                      </Link>
                      <time className="review-card-date" dateTime={r.created_at.slice(0, 10)}>
                        {r.created_at.slice(0, 10)}
                      </time>
                    </header>
                    <p className="review-card-body small muted">{r.authors.map((a) => a.name).join(', ') || 'Unknown authors'}</p>
                  </article>
                ))}
              </div>
            )}
            {user ? (
              <Link className="btn btn-ghost btn-sm" to={`/works/${work.id}/review`} style={{ alignSelf: 'flex-start' }}>
                Write a review
              </Link>
            ) : (
              <Link className="btn btn-ghost btn-sm" to="/login" style={{ alignSelf: 'flex-start' }}>
                Log in to write a review
              </Link>
            )}
          </div>

          <div className="stack gap-3">
            <h2 style={{ fontSize: 'var(--font-size-lg)' }}>Conversations</h2>
            {chatsLoading ? (
              <div className="stack gap-2">
                <div className="skeleton skeleton-text" />
              </div>
            ) : chats.length === 0 ? (
              <p className="small muted">
                No verified conversations reference this work yet.{' '}
                <Link to="/chats/new">Upload one</Link>.
              </p>
            ) : (
              <div className="stack gap-3">
                {chats.map(({ chat, link }) => (
                  <article className="review-card" key={link.id}>
                    <header className="review-card-head">
                      <Link to={`/chats/${chat.id}`} style={{ fontWeight: 'var(--font-weight-semibold)' }}>
                        {chat.title}
                      </Link>
                      <time className="review-card-date" dateTime={chat.created_at.slice(0, 10)}>
                        {chat.created_at.slice(0, 10)}
                      </time>
                    </header>
                    <p className="review-card-body small muted">
                      <span className="badge">{chat.platform}</span> Verified by{' '}
                      {chat.uploader_name ?? `user #${chat.uploaded_by}`}
                      {link.origin === 'ai' ? ' · AI-matched, uploader-confirmed' : ''}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div>
            {aiLoading ? (
              <div className="stack gap-2">
                <div className="skeleton skeleton-title" />
                <div className="skeleton skeleton-text" />
                <div className="skeleton skeleton-text" style={{ width: '70%' }} />
              </div>
            ) : aiError ? (
              <div className="empty-state">
                <p className="empty-state-title">Couldn&rsquo;t load AI content</p>
                <p className="empty-state-body">{aiError}</p>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => void loadAi()}>
                  Retry
                </button>
              </div>
            ) : (
              <AiPanel workId={work.id} tier={work.tier} outputs={aiOutputs} onChange={() => void loadAi()} />
            )}
          </div>
        </aside>
      </div>

      {/* ---------------- Comments ---------------- */}
      <section id="comments" className="stack gap-3">
        <h2>Comments</h2>
        {commentsLoading ? (
          <div className="stack gap-2">
            <div className="skeleton skeleton-text" />
            <div className="skeleton skeleton-text" style={{ width: '80%' }} />
          </div>
        ) : commentsError ? (
          <div className="empty-state">
            <p className="empty-state-title">Couldn&rsquo;t load comments</p>
            <p className="empty-state-body">{commentsError}</p>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void loadComments()}>
              Retry
            </button>
          </div>
        ) : (
          <CommentThread workId={work.id} comments={comments} onChange={() => void loadComments()} />
        )}
      </section>
    </div>
  );
}
