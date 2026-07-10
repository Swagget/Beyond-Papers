// Version history + revert (§1.3, §12.5). Every version is immutable and
// content-addressed; revert creates a brand-new version rather than mutating
// history.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Paginated, WorkDetail, WorkVersion } from '@shared/types';
import { licenseToTier } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';
import { TierBadge } from '../components/Badges';

export default function VersionsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [work, setWork] = useState<WorkDetail | null>(null);
  const [versions, setVersions] = useState<WorkVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [revertTarget, setRevertTarget] = useState<WorkVersion | null>(null);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<{ work: WorkDetail }>(`/api/works/${id}`),
      api.get<Paginated<WorkVersion>>(`/api/works/${id}/versions?limit=100`),
    ])
      .then(([workRes, versionsRes]) => {
        if (cancelled) return;
        setWork(workRes.work);
        setVersions([...versionsRes.items].sort((a, b) => b.version_number - a.version_number));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiRequestError ? err.message : 'Failed to load version history.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const doRevert = async () => {
    if (!id || !revertTarget) return;
    setReverting(true);
    setRevertError(null);
    try {
      await api.post(`/api/works/${id}/revert`, { version_id: revertTarget.id });
      navigate(`/works/${id}`);
    } catch (err) {
      setRevertError(err instanceof ApiRequestError ? err.message : 'Revert failed.');
      setReverting(false);
    }
  };

  if (loading) {
    return (
      <div className="stack gap-3">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-text" />
        <div className="skeleton skeleton-text" style={{ width: '80%' }} />
        <div className="skeleton skeleton-text" style={{ width: '60%' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Couldn't load version history</p>
        <p className="empty-state-body">{error}</p>
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

  return (
    <div className="stack gap-5">
      <div className="stack gap-1">
        <h1>Version history</h1>
        <p className="muted">
          <Link to={`/works/${work.id}`}>{work.title}</Link>
        </p>
        <p className="field-hint">Every version is immutable and permanently citable by hash.</p>
      </div>

      {versions.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">No versions yet</p>
          <p className="empty-state-body">This work has no recorded version history.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Created</th>
                <th>Change note</th>
                <th>License / tier</th>
                <th>Content hash</th>
                <th>Created by</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const isCurrent = v.id === work.current_version_id;
                return (
                  <tr
                    key={v.id}
                    style={isCurrent ? { background: 'var(--color-accent-soft)' } : undefined}
                  >
                    <td>
                      v{v.version_number}
                      {isCurrent ? (
                        <span
                          className="badge badge-status-confirmed"
                          style={{ marginLeft: 'var(--space-2)' }}
                        >
                          current
                        </span>
                      ) : null}
                    </td>
                    <td>{v.created_at.slice(0, 10)}</td>
                    <td>{v.change_note ? v.change_note : <span className="muted">—</span>}</td>
                    <td>
                      <TierBadge tier={licenseToTier(v.license)} license={v.license} />
                    </td>
                    <td>
                      <Link to={`/versions/${v.content_hash}`}>
                        <code>{v.content_hash.slice(0, 12)}</code>
                      </Link>
                    </td>
                    <td>
                      {v.created_by != null ? (
                        <Link to={`/users/${v.created_by}`}>User #{v.created_by}</Link>
                      ) : (
                        <span className="muted">imported</span>
                      )}
                    </td>
                    <td>
                      {isCurrent ? null : user ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            setRevertTarget(v);
                            setRevertError(null);
                          }}
                        >
                          Revert
                        </button>
                      ) : (
                        <Link to="/login" className="small">
                          Log in to revert
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {revertTarget ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!reverting) setRevertTarget(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="revert-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-header">
              <h2 id="revert-modal-title">Revert to version {revertTarget.version_number}?</h2>
              <button
                type="button"
                className="modal-close"
                aria-label="Close"
                onClick={() => setRevertTarget(null)}
                disabled={reverting}
              >
                ×
              </button>
            </header>
            <div className="modal-body stack gap-3">
              <p>
                This creates a brand-new version whose content is copied byte-for-byte from v
                {revertTarget.version_number} (hash{' '}
                <code>{revertTarget.content_hash.slice(0, 12)}</code>). The current version stays
                permanently citable by its own hash — nothing is deleted.
              </p>
              {revertError ? <p style={{ color: 'var(--color-danger)' }}>{revertError}</p> : null}
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRevertTarget(null)}
                disabled={reverting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void doRevert()}
                disabled={reverting}
              >
                {reverting ? 'Reverting…' : 'Revert'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
