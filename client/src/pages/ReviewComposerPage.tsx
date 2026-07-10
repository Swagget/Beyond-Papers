// Route: /works/:id/review — POST /api/works/:id/reviews. See docs/ARCHITECTURE.md §13.5, §5.1, §6.3.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { EdgeDetail, WorkDetail, WorkSummary } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';
import WorkForm, { type WorkFormPayload } from '../components/WorkForm';
import { TierBadge } from '../components/Badges';

export default function ReviewComposerPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [target, setTarget] = useState<WorkSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ work: WorkDetail }>(`/api/works/${id}`)
      .then((res) => {
        if (!cancelled) setTarget(res.work);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiRequestError ? err.message : 'Failed to load the work being reviewed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(payload: WorkFormPayload) {
    const res = await api.post<{ review: WorkDetail; edge: EdgeDetail }>(`/api/works/${id}/reviews`, {
      title: payload.title,
      abstract: payload.abstract,
      sections: payload.sections,
      references: payload.references,
      license: payload.license,
    });
    navigate(`/works/${res.review.id}`);
  }

  if (authLoading || loading) {
    return (
      <div className="stack">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-text" />
        <div className="skeleton skeleton-text" style={{ width: '80%' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Couldn't load the work being reviewed</p>
        <p className="empty-state-body">{error}</p>
      </div>
    );
  }

  if (!target) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Work not found</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1>Write a review</h1>
        <p className="muted">Reviews are first-class, citable works that build your record (§5.1, §6.3).</p>
      </div>
      <div className="card">
        <p className="small muted">Reviewing</p>
        <h3 className="card-title">
          <Link to={`/works/${target.id}`}>{target.title}</Link>
        </h3>
        <div className="card-badges">
          <TierBadge tier={target.tier} license={target.license} />
        </div>
      </div>
      {!user ? (
        <div className="empty-state">
          <p className="empty-state-title">Log in to write a review</p>
          <p className="empty-state-body">Reviewing requires an account so your credit record can attach to it.</p>
          <Link to="/login" className="btn btn-primary btn-sm">
            Log in
          </Link>
        </div>
      ) : (
        <WorkForm mode="review" onSubmit={handleSubmit} submitLabel="Publish review" />
      )}
    </div>
  );
}
