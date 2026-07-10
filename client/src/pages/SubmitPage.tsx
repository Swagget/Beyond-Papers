// Route: /works/new — POST /api/works. See docs/ARCHITECTURE.md §12, §13.3.

import { Link, useNavigate } from 'react-router-dom';
import type { WorkDetail } from '@shared/types';
import { api } from '../api';
import { useAuth } from '../auth';
import WorkForm, { type WorkFormPayload } from '../components/WorkForm';

export default function SubmitPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="stack">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-text" />
        <div className="skeleton skeleton-text" style={{ width: '80%' }} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Log in to contribute a work</p>
        <p className="empty-state-body">
          Contribution is open to anyone with an account — no gatekeeper at submission (§12.1).
        </p>
        <Link to="/login" className="btn btn-primary btn-sm">
          Log in
        </Link>
      </div>
    );
  }

  async function handleSubmit(payload: WorkFormPayload) {
    const res = await api.post<{ work: WorkDetail }>('/api/works', {
      kind: payload.kind,
      result_nature: payload.result_nature,
      editing: payload.editing,
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
        <h1>Contribute a work</h1>
        <p className="muted">No gatekeeper — reviewed openly after publication (§12.1).</p>
      </div>
      <WorkForm mode="create" onSubmit={handleSubmit} submitLabel="Publish" />
    </div>
  );
}
