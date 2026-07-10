import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Flag, FlagStatus, FlagTargetType, Paginated } from '@shared/types';
import { useAuth } from '../auth';
import { api, ApiRequestError } from '../api';

const PAGE_SIZE = 50;

export default function FlagsPage() {
  const { user, loading: authLoading } = useAuth();

  const [statusFilter, setStatusFilter] = useState<FlagStatus | 'all'>('open');
  const [targetTypeFilter, setTargetTypeFilter] = useState<FlagTargetType | 'all'>('all');

  const [flags, setFlags] = useState<Flag[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(
    (offset: number) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (targetTypeFilter !== 'all') params.set('target_type', targetTypeFilter);
      api
        .get<Paginated<Flag>>(`/api/flags?${params.toString()}`)
        .then((res) => {
          setFlags((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
          setTotal(res.total);
          setForbidden(false);
        })
        .catch((err) => {
          if (err instanceof ApiRequestError && err.status === 403) {
            setForbidden(true);
          } else {
            setError(err instanceof ApiRequestError ? err.message : 'Failed to load flags.');
          }
        })
        .finally(() => setLoading(false));
    },
    [statusFilter, targetTypeFilter],
  );

  useEffect(() => {
    if (!user) return;
    load(0);
  }, [user, load]);

  const handleResolved = (updated: Flag) => {
    setFlags((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  };

  if (authLoading) {
    return (
      <div className="stack">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-text" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Sign in required</p>
        <p className="empty-state-body">Admin access required.</p>
        <Link to="/login" className="btn btn-primary btn-sm">
          Log in
        </Link>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Admin access required</p>
        <p className="empty-state-body">The moderation queue is only visible to platform administrators.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="stack gap-1">
        <h1>Moderation queue</h1>
        <p className="small muted">
          Flags on AI output feed the <Link to="/ai/track-record">public track record</Link>.
        </p>
      </header>

      <div className="row flex-wrap gap-4">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="flags-status-filter">Status</label>
          <select
            id="flags-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as FlagStatus | 'all')}
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="upheld">Upheld</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="flags-target-filter">Target type</label>
          <select
            id="flags-target-filter"
            value={targetTypeFilter}
            onChange={(e) => setTargetTypeFilter(e.target.value as FlagTargetType | 'all')}
          >
            <option value="all">All</option>
            <option value="ai_output">AI output</option>
            <option value="edge">Edge</option>
          </select>
        </div>
      </div>

      {error ? (
        <p className="small" role="alert" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      ) : null}

      {loading && flags.length === 0 ? (
        <div className="stack">
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text" style={{ width: '80%' }} />
        </div>
      ) : flags.length === 0 && !error ? (
        <div className="empty-state">
          <p className="empty-state-title">No flags</p>
          <p className="empty-state-body">No flags match the current filters.</p>
        </div>
      ) : (
        <div className="stack">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Target</th>
                  <th>Reason</th>
                  <th>Reporter</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Resolve</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((flag) => (
                  <tr key={flag.id}>
                    <td>{flag.id}</td>
                    <td>
                      {flag.target_type} #{flag.target_id}
                    </td>
                    <td>{flag.reason}</td>
                    <td>
                      <Link to={`/users/${flag.reporter_user_id}`}>User #{flag.reporter_user_id}</Link>
                    </td>
                    <td>{flag.created_at.slice(0, 10)}</td>
                    <td>
                      {flag.status}
                      {flag.resolution_note ? <div className="small muted">{flag.resolution_note}</div> : null}
                    </td>
                    <td>
                      {flag.status === 'open' ? (
                        <ResolveControls flag={flag} onResolved={handleResolved} />
                      ) : (
                        <span className="small muted">
                          {flag.resolved_at ? `resolved ${flag.resolved_at.slice(0, 10)}` : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {flags.length < total ? (
            <button className="btn btn-ghost" onClick={() => load(flags.length)} disabled={loading}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ResolveControls({ flag, onResolved }: { flag: Flag; onResolved: (updated: Flag) => void }) {
  const [status, setStatus] = useState<'upheld' | 'dismissed'>('upheld');
  const [action, setAction] = useState<'remove' | 'keep'>('remove');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ flag: Flag }>(`/api/flags/${flag.id}/resolve`, {
        status,
        resolution_note: note,
        action: status === 'upheld' ? action : undefined,
      });
      onResolved(res.flag);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to resolve flag.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="row flex-wrap gap-2" aria-label={`Resolve flag ${flag.id}`}>
      <label className="sr-only" htmlFor={`flag-status-${flag.id}`}>
        Resolution status
      </label>
      <select
        id={`flag-status-${flag.id}`}
        value={status}
        onChange={(e) => setStatus(e.target.value as 'upheld' | 'dismissed')}
        style={{ width: 'auto' }}
      >
        <option value="upheld">Upheld</option>
        <option value="dismissed">Dismissed</option>
      </select>
      {status === 'upheld' ? (
        <>
          <label className="sr-only" htmlFor={`flag-action-${flag.id}`}>
            Action
          </label>
          <select
            id={`flag-action-${flag.id}`}
            value={action}
            onChange={(e) => setAction(e.target.value as 'remove' | 'keep')}
            style={{ width: 'auto' }}
          >
            <option value="remove">Remove</option>
            <option value="keep">Keep</option>
          </select>
        </>
      ) : null}
      <label className="sr-only" htmlFor={`flag-note-${flag.id}`}>
        Resolution note
      </label>
      <input
        id={`flag-note-${flag.id}`}
        type="text"
        placeholder="Resolution note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        required
        style={{ minWidth: '12rem' }}
      />
      <button type="submit" className="btn btn-sm btn-primary" disabled={submitting}>
        {submitting ? 'Saving…' : 'Resolve'}
      </button>
      {error ? (
        <span className="small" role="alert" style={{ color: 'var(--color-danger)' }}>
          {error}
        </span>
      ) : null}
    </form>
  );
}
