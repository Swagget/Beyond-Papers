// Chat detail + verification workbench. The uploader resolves every AI-suggested
// work attachment (confirm/reject), can attach works manually via search, and then
// marks the chat verified — only then do the chat and its confirmed links appear
// publicly (chat list, work pages). Mirrors the §4.1–4.2 human-promotion path.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ChatDetail, ChatLinkDetail, SearchResponse } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';
import { AiBadge, ConfidencePct, KindBadge } from '../components/Badges';

function errMsg(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.';
}

function PlatformBadge({ platform }: { platform: string }) {
  return <span className="badge">{platform}</span>;
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const chatId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();

  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyLinkId, setBusyLinkId] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ chat: ChatDetail }>(`/api/chats/${chatId}`);
      setChat(res.chat);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Manual attach via search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setActionError(null);
    try {
      const res = await api.get<SearchResponse>(`/api/search?q=${encodeURIComponent(query.trim())}&limit=8`);
      setResults(res);
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setSearching(false);
    }
  }

  async function act(fn: () => Promise<{ chat: ChatDetail }>, linkId: number | null = null) {
    setBusyLinkId(linkId ?? -1);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusyLinkId(null);
    }
  }

  const confirmLink = (l: ChatLinkDetail) =>
    void act(() => api.post(`/api/chats/${chatId}/links/${l.id}/confirm`), l.id);
  const rejectLink = (l: ChatLinkDetail) =>
    void act(() => api.post(`/api/chats/${chatId}/links/${l.id}/reject`), l.id);
  const attachWork = (workId: number) => void act(() => api.post(`/api/chats/${chatId}/links`, { work_id: workId }));
  const verify = () => void act(() => api.post(`/api/chats/${chatId}/verify`));

  async function remove() {
    if (!window.confirm('Delete this conversation and all its links? This cannot be undone.')) return;
    setActionError(null);
    try {
      await api.del(`/api/chats/${chatId}`);
      navigate('/chats');
    } catch (err) {
      setActionError(errMsg(err));
    }
  }

  if (!id || Number.isNaN(chatId)) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Invalid chat</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="stack gap-4">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-text" />
        <div className="skeleton skeleton-text" style={{ width: '70%' }} />
      </div>
    );
  }
  if (error || !chat) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Couldn&rsquo;t load this chat</p>
        <p className="empty-state-body">{error ?? 'Chat not found.'}</p>
      </div>
    );
  }

  const isUploader = !!user && user.id === chat.uploaded_by;
  const suggested = chat.links.filter((l) => l.status === 'suggested');
  const confirmed = chat.links.filter((l) => l.status === 'confirmed');
  const rejected = chat.links.filter((l) => l.status === 'rejected');

  return (
    <div className="stack gap-6" style={{ maxWidth: '52rem' }}>
      <div className="stack gap-2">
        <div className="row flex-wrap gap-2">
          <PlatformBadge platform={chat.platform} />
          <span className="badge">{chat.status === 'verified' ? 'Verified by uploader' : 'Pending verification'}</span>
        </div>
        <h1>{chat.title}</h1>
        <p className="small muted">
          Uploaded by {chat.uploader_name ?? `user #${chat.uploaded_by}`} on {chat.created_at.slice(0, 10)}
          {chat.verified_at ? ` · verified ${chat.verified_at.slice(0, 10)}` : ''}
          {chat.url ? (
            <>
              {' · '}
              <a href={chat.url} target="_blank" rel="noreferrer">
                original conversation
              </a>
            </>
          ) : null}
        </p>
      </div>

      {chat.status === 'pending' && isUploader ? (
        <div className="toast toast-warning" role="status" style={{ position: 'static' }}>
          <span className="toast-message">
            This chat is only visible to you. Confirm or reject every suggested work below, then verify to
            publish it and its confirmed attachments.
          </span>
        </div>
      ) : null}

      {actionError ? (
        <p className="small" style={{ color: 'var(--color-danger)' }}>
          {actionError}
        </p>
      ) : null}

      {/* ---------- Suggested attachments ---------- */}
      {suggested.length > 0 ? (
        <section className="stack gap-3">
          <h2 style={{ fontSize: 'var(--font-size-lg)' }}>Suggested works ({suggested.length})</h2>
          <div className="stack gap-3">
            {suggested.map((l) => (
              <div key={l.id} className="edge-item edge-item-ai">
                <div className="edge-item-main">
                  <AiBadge label={l.model === 'identifier-extractor' ? 'Identifier match' : 'AI-matched'} />
                  <KindBadge kind={l.work_kind} />
                  <ConfidencePct confidence={l.confidence} />
                </div>
                <div className="edge-item-meta">
                  <Link to={`/works/${l.work_id}`}>{l.work_title}</Link>
                </div>
                {l.basis ? <p className="small muted">{l.basis}</p> : null}
                {isUploader ? (
                  <div className="row gap-2">
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      disabled={busyLinkId !== null}
                      onClick={() => confirmLink(l)}
                    >
                      {busyLinkId === l.id ? '…' : 'Confirm'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={busyLinkId !== null}
                      onClick={() => rejectLink(l)}
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---------- Confirmed attachments ---------- */}
      <section className="stack gap-3">
        <h2 style={{ fontSize: 'var(--font-size-lg)' }}>Attached works ({confirmed.length})</h2>
        {confirmed.length === 0 ? (
          <p className="small muted">No confirmed attachments yet.</p>
        ) : (
          <div className="stack gap-2">
            {confirmed.map((l) => (
              <div key={l.id} className="edge-item edge-item-human" style={{ borderLeftStyle: 'solid' }}>
                <div className="edge-item-main">
                  <KindBadge kind={l.work_kind} />
                  {l.origin === 'ai' ? <AiBadge label="AI-matched, uploader-confirmed" /> : null}
                </div>
                <div className="edge-item-meta">
                  <Link to={`/works/${l.work_id}`}>{l.work_title}</Link>
                </div>
                {isUploader ? (
                  <div className="row gap-2">
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={busyLinkId !== null}
                      onClick={() => rejectLink(l)}
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- Manual attach ---------- */}
      {isUploader ? (
        <section className="stack gap-3">
          <h2 style={{ fontSize: 'var(--font-size-lg)' }}>Attach another work</h2>
          <form className="row gap-2" onSubmit={(e) => void runSearch(e)}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search works to attach…"
              aria-label="Search works to attach"
              style={{ flex: 1 }}
            />
            <button className="btn btn-ghost btn-sm" type="submit" disabled={searching}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </form>
          {results ? (
            results.items.length === 0 ? (
              <p className="small muted">No works matched that search.</p>
            ) : (
              <div className="stack gap-2">
                {results.items.map(({ work }) => (
                  <div key={work.id} className="row gap-2 items-center flex-wrap">
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      disabled={busyLinkId !== null || chat.links.some((l) => l.work_id === work.id && l.status !== 'rejected')}
                      onClick={() => attachWork(work.id)}
                    >
                      Attach
                    </button>
                    <Link to={`/works/${work.id}`}>{work.title}</Link>
                  </div>
                ))}
              </div>
            )
          ) : null}
        </section>
      ) : null}

      {/* ---------- Verify / delete ---------- */}
      {isUploader ? (
        <section className="stack gap-2">
          {chat.status === 'pending' ? (
            <>
              <button
                className="btn btn-primary"
                type="button"
                disabled={suggested.length > 0 || busyLinkId !== null}
                onClick={verify}
                style={{ alignSelf: 'flex-start' }}
              >
                Verify &amp; publish
              </button>
              {suggested.length > 0 ? (
                <p className="small muted">
                  Resolve the {suggested.length} remaining suggestion{suggested.length === 1 ? '' : 's'} to
                  enable verification.
                </p>
              ) : null}
            </>
          ) : null}
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void remove()} style={{ alignSelf: 'flex-start' }}>
            Delete conversation
          </button>
        </section>
      ) : null}

      {rejected.length > 0 && isUploader ? (
        <details>
          <summary className="small muted">Rejected suggestions ({rejected.length})</summary>
          <ul className="small muted" style={{ paddingLeft: 'var(--space-5)' }}>
            {rejected.map((l) => (
              <li key={l.id}>
                <Link to={`/works/${l.work_id}`}>{l.work_title}</Link>
                {isUploader ? (
                  <>
                    {' — '}
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => confirmLink(l)}>
                      restore
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* ---------- Transcript ---------- */}
      <section className="stack gap-2">
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          onClick={() => setShowTranscript((v) => !v)}
          style={{ alignSelf: 'flex-start' }}
        >
          {showTranscript ? 'Hide transcript' : 'Show transcript'}
        </button>
        {showTranscript ? (
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              maxHeight: '32rem',
              overflowY: 'auto',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            {chat.transcript}
          </pre>
        ) : null}
      </section>
    </div>
  );
}
