// Conversation list: verified chats (public) plus a "Mine" tab for the caller's
// own uploads in any status.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChatSummary, Paginated } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';

export default function ChatsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'verified' | 'mine'>('verified');
  const [items, setItems] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Paginated<ChatSummary>>(`/api/chats${tab === 'mine' ? '?mine=true' : ''}`);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to load conversations.');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack gap-5">
      <div className="row flex-wrap gap-3 items-center" style={{ justifyContent: 'space-between' }}>
        <h1>Conversations</h1>
        <Link className="btn btn-primary btn-sm" to="/chats/new">
          Upload a conversation
        </Link>
      </div>
      <p className="muted" style={{ maxWidth: '46rem' }}>
        AI chats uploaded by the community, matched to the research works they discuss, and personally verified
        by their uploaders before appearing here.
      </p>

      {user ? (
        <div className="row gap-2">
          <button
            className={`btn btn-sm ${tab === 'verified' ? 'btn-primary' : 'btn-ghost'}`}
            type="button"
            onClick={() => setTab('verified')}
          >
            Verified
          </button>
          <button
            className={`btn btn-sm ${tab === 'mine' ? 'btn-primary' : 'btn-ghost'}`}
            type="button"
            onClick={() => setTab('mine')}
          >
            Mine
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="stack gap-2">
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text" style={{ width: '80%' }} />
          <div className="skeleton skeleton-text" style={{ width: '60%' }} />
        </div>
      ) : error ? (
        <div className="empty-state">
          <p className="empty-state-title">Couldn&rsquo;t load conversations</p>
          <p className="empty-state-body">{error}</p>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">
            {tab === 'mine' ? 'You haven’t uploaded any conversations yet' : 'No verified conversations yet'}
          </p>
          <p className="empty-state-body">
            <Link to="/chats/new">Upload one</Link> — paste an AI chat and the platform will find the works it
            relates to.
          </p>
        </div>
      ) : (
        <div className="stack gap-3">
          {items.map((c) => (
            <article key={c.id} className="review-card">
              <header className="review-card-head">
                <Link to={`/chats/${c.id}`} style={{ fontWeight: 'var(--font-weight-semibold)' }}>
                  {c.title}
                </Link>
                <time className="review-card-date" dateTime={c.created_at.slice(0, 10)}>
                  {c.created_at.slice(0, 10)}
                </time>
              </header>
              <p className="review-card-body small muted">
                <span className="badge">{c.platform}</span>{' '}
                {c.status === 'verified' ? 'Verified' : 'Pending'} · {c.confirmed_link_count} attached work
                {c.confirmed_link_count === 1 ? '' : 's'}
                {c.suggested_link_count > 0 ? ` · ${c.suggested_link_count} pending suggestion(s)` : ''} · by{' '}
                {c.uploader_name ?? `user #${c.uploaded_by}`}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
