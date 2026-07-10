// Route: /works/:id/edit — PATCH /api/works/:id. See docs/ARCHITECTURE.md §12, §13.3, §12.3.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { WorkDetail } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';
import WorkForm, { type WorkFormPayload } from '../components/WorkForm';

export default function EditWorkPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [work, setWork] = useState<WorkDetail | null>(null);
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
        if (!cancelled) setWork(res.work);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiRequestError ? err.message : 'Failed to load this work.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

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
        <p className="empty-state-title">Couldn't load this work</p>
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

  if (!user) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Log in to edit this work</p>
        <p className="empty-state-body">Editing requires an account.</p>
        <Link to="/login" className="btn btn-primary btn-sm">
          Log in
        </Link>
      </div>
    );
  }

  const isAuthor = work.created_by === user.id || work.authors.some((a) => a.user_id === user.id);
  const canEdit = work.editing === 'communal' || isAuthor;

  if (!canEdit) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">This work is authored, not communal</p>
        <p className="empty-state-body">
          Only its authors can edit it directly (§12.3). In this MVP, non-authors propose changes by writing a
          review of the work rather than editing it in place.
        </p>
        <Link to={`/works/${work.id}`} className="btn btn-ghost btn-sm">
          Back to work
        </Link>
      </div>
    );
  }

  const content = work.current_version?.content;

  async function handleSubmit(payload: WorkFormPayload) {
    const res = await api.patch<{ work: WorkDetail }>(`/api/works/${work!.id}`, {
      change_note: payload.change_note,
      title: payload.title,
      abstract: payload.abstract,
      sections: payload.sections,
      references: payload.references,
      license: payload.license,
    });
    navigate(`/works/${res.work.id}`);
  }

  return (
    <div className="stack">
      <div>
        <h1>Edit “{work.title}”</h1>
        <p className="muted">Saving creates a new immutable version (§1.3).</p>
      </div>
      <WorkForm
        mode="edit"
        initial={{
          kind: work.kind,
          result_nature: work.result_nature,
          editing: work.editing,
          title: content?.title ?? work.title,
          abstract: content?.abstract ?? work.abstract ?? '',
          sections: content?.sections ?? [],
          references: content?.references ?? [],
          license: work.current_version?.license ?? work.license,
        }}
        onSubmit={handleSubmit}
        submitLabel="Save new version"
      />
    </div>
  );
}
