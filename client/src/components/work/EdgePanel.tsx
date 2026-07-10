// Right-rail connections panel (§2.1–2.4, §4.1–4.2). Renders confirmed/
// disputed connections separately from AI-suggested ones (never mixed into
// the "Connections (N)" count — §4.2 trust boundary).

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { EdgeDetail, EdgeType } from '@shared/types';
import { EDGE_TYPES } from '@shared/types';
import { api, ApiRequestError } from '../../api';
import { useAuth } from '../../auth';
import { AiBadge, ConfidencePct, EdgeStatusBadge, EdgeTypeBadge } from '../Badges';

function errMsg(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.';
}

interface EdgePanelProps {
  workId: number;
  edges: EdgeDetail[];
  onChange: () => void;
}

export default function EdgePanel({ workId, edges, onChange }: EdgePanelProps) {
  const { user } = useAuth();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const [targetId, setTargetId] = useState('');
  const [edgeType, setEdgeType] = useState<EdgeType>(EDGE_TYPES[0]);
  const [basis, setBasis] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Confirmed/disputed connections — human-verified or AI edges promoted by
  // a human. Rejected edges are never rendered (matches EdgeStatusBadge).
  const connections = edges.filter((e) => e.status === 'confirmed' || e.status === 'disputed');
  // Unconfirmed AI suggestions — a distinct, clearly-labeled group, never
  // counted in the "Connections (N)" heading.
  const suggestions = edges.filter((e) => e.origin === 'ai' && e.status === 'suggested');

  function direction(e: EdgeDetail): { label: string; to: string } {
    if (e.source_work_id === workId) {
      return { label: `→ ${e.target_title ?? `Work #${e.target_work_id}`}`, to: `/works/${e.target_work_id}` };
    }
    return { label: `${e.source_title ?? `Work #${e.source_work_id}`} →`, to: `/works/${e.source_work_id}` };
  }

  async function runAction(edgeId: number, fn: () => Promise<unknown>) {
    setBusyId(edgeId);
    setActionError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }

  const vote = (edgeId: number, value: 1 | -1) =>
    runAction(edgeId, () => api.post(`/api/edges/${edgeId}/vote`, { vote: value }));
  const dispute = (edgeId: number) => runAction(edgeId, () => api.post(`/api/edges/${edgeId}/dispute`, {}));
  const confirmEdge = (edgeId: number) => runAction(edgeId, () => api.post(`/api/edges/${edgeId}/confirm`));
  const rejectEdge = (edgeId: number) => runAction(edgeId, () => api.post(`/api/edges/${edgeId}/reject`, {}));

  function flagEdge(edgeId: number) {
    const reason = window.prompt('Why are you flagging this suggested connection?');
    if (!reason || !reason.trim()) return;
    void runAction(edgeId, () =>
      api.post('/api/flags', { target_type: 'edge', target_id: edgeId, reason: reason.trim() }),
    );
  }

  async function suggestConnections() {
    setSuggesting(true);
    setSuggestError(null);
    try {
      await api.post(`/api/works/${workId}/ai/suggest-edges`);
      onChange();
    } catch (err) {
      setSuggestError(errMsg(err));
    } finally {
      setSuggesting(false);
    }
  }

  async function submitConnection(e: FormEvent) {
    e.preventDefault();
    const target = Number(targetId);
    if (!targetId.trim() || Number.isNaN(target) || target === workId) {
      setFormError('Enter a valid target work ID.');
      return;
    }
    setFormBusy(true);
    setFormError(null);
    try {
      await api.post('/api/edges', {
        source_work_id: workId,
        target_work_id: target,
        type: edgeType,
        basis: basis.trim() || undefined,
      });
      setTargetId('');
      setBasis('');
      onChange();
    } catch (err) {
      setFormError(errMsg(err));
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <section className="stack gap-3" aria-label="Connections">
      <div className="row justify-between items-center flex-wrap gap-2">
        <h2 style={{ fontSize: 'var(--font-size-lg)' }}>Connections ({connections.length})</h2>
        {user ? (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void suggestConnections()} disabled={suggesting}>
            {suggesting ? 'Suggesting…' : 'Suggest connections (AI)'}
          </button>
        ) : null}
      </div>

      {suggestError ? (
        <p className="small" style={{ color: 'var(--color-danger)' }}>
          {suggestError}
        </p>
      ) : null}
      {actionError ? (
        <p className="small" style={{ color: 'var(--color-danger)' }}>
          {actionError}
        </p>
      ) : null}

      {connections.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">No confirmed connections yet</p>
          <p className="empty-state-body">Propose a typed connection below, or suggest AI candidates.</p>
        </div>
      ) : (
        <div className="stack gap-2">
          {connections.map((e) => {
            const dir = direction(e);
            const score = e.votes.up - e.votes.down;
            return (
              <div key={e.id} className={`edge-item edge-item-human edge-${e.type}`}>
                <div className="edge-item-main">
                  <EdgeTypeBadge type={e.type} />
                  <Link to={dir.to} className="edge-item-target">
                    {dir.label}
                  </Link>
                </div>
                <div className="edge-item-meta">
                  <EdgeStatusBadge status={e.status} />
                  {user ? (
                    <div className="vote" role="group" aria-label="Vote on this connection">
                      <button
                        className="vote-btn vote-up"
                        type="button"
                        aria-label="Upvote"
                        aria-pressed={e.votes.my_vote === 1}
                        disabled={busyId === e.id}
                        onClick={() => void vote(e.id, 1)}
                      >
                        ▲
                      </button>
                      <span className="vote-count">{score >= 0 ? `+${score}` : score}</span>
                      <button
                        className="vote-btn vote-down"
                        type="button"
                        aria-label="Downvote"
                        aria-pressed={e.votes.my_vote === -1}
                        disabled={busyId === e.id}
                        onClick={() => void vote(e.id, -1)}
                      >
                        ▼
                      </button>
                    </div>
                  ) : (
                    <span className="vote-count">{score >= 0 ? `+${score}` : score}</span>
                  )}
                  {user && e.status === 'confirmed' ? (
                    <button
                      className="btn btn-sm btn-ghost"
                      type="button"
                      disabled={busyId === e.id}
                      onClick={() => void dispute(e.id)}
                    >
                      Dispute
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="stack gap-2">
        <div className="row items-center gap-2">
          <h3 style={{ fontSize: 'var(--font-size-md)' }}>AI-suggested connections</h3>
          <AiBadge label="AI" />
        </div>
        {suggestions.length === 0 ? (
          <p className="small muted">No AI-suggested connections right now.</p>
        ) : (
          suggestions.map((e) => {
            const dir = direction(e);
            return (
              <div key={e.id} className={`edge-item edge-item-ai edge-${e.type}`}>
                <div className="edge-item-main">
                  <AiBadge />
                  <EdgeTypeBadge type={e.type} />
                  <Link to={dir.to} className="edge-item-target">
                    {dir.label}
                  </Link>
                  <ConfidencePct confidence={e.confidence} />
                </div>
                {e.basis ? <p className="small muted">{e.basis}</p> : null}
                <div className="edge-item-meta">
                  <span>
                    proposed by {e.model ?? 'unknown model'}
                    {e.model_version ? ` · ${e.model_version}` : ''} · {e.created_at.slice(0, 10)}
                  </span>
                  {user ? (
                    <>
                      <button
                        className="btn btn-sm btn-ghost"
                        type="button"
                        disabled={busyId === e.id}
                        onClick={() => void confirmEdge(e.id)}
                      >
                        Confirm
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        type="button"
                        disabled={busyId === e.id}
                        onClick={() => void rejectEdge(e.id)}
                      >
                        Reject
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        type="button"
                        disabled={busyId === e.id}
                        onClick={() => flagEdge(e.id)}
                      >
                        Flag
                      </button>
                    </>
                  ) : (
                    <Link to="/login" className="small">
                      Log in to confirm, reject, or flag
                    </Link>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {user ? (
        <form className="stack gap-2" onSubmit={(e) => void submitConnection(e)} aria-label="Add a connection">
          <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' }}>Add connection</h3>
          <div className="field">
            <label htmlFor="edge-target">Target work ID</label>
            <input
              id="edge-target"
              type="number"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="edge-type">Type</label>
            <select id="edge-type" value={edgeType} onChange={(e) => setEdgeType(e.target.value as EdgeType)}>
              {EDGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="edge-basis">Basis (optional)</label>
            <textarea id="edge-basis" value={basis} onChange={(e) => setBasis(e.target.value)} />
          </div>
          {formError ? (
            <p className="small" style={{ color: 'var(--color-danger)' }}>
              {formError}
            </p>
          ) : null}
          <button className="btn btn-primary btn-sm" type="submit" disabled={formBusy} style={{ alignSelf: 'flex-start' }}>
            {formBusy ? 'Adding…' : 'Add connection'}
          </button>
        </form>
      ) : (
        <p className="small muted">
          <Link to="/login">Log in</Link> to propose a connection.
        </p>
      )}
    </section>
  );
}
