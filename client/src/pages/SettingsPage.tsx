import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '@shared/types';
import { useAuth } from '../auth';
import { api, ApiRequestError } from '../api';
import AiCredentialSection from '../components/AiCredentialSection';

const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export default function SettingsPage() {
  const { user, loading, refresh } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [orcid, setOrcid] = useState('');
  const [isPseudonym, setIsPseudonym] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name);
      setBio(user.bio ?? '');
      setOrcid(user.orcid ?? '');
      setIsPseudonym(user.is_pseudonym);
    }
  }, [user]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSuccess(false);

    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    if (orcid && !ORCID_PATTERN.test(orcid)) {
      setError('ORCID must look like 0000-0002-1825-0097.');
      return;
    }

    setSaving(true);
    try {
      await api.patch<{ user: User }>(`/api/users/${user.id}`, {
        display_name: displayName.trim(),
        bio: bio.trim() || null,
        orcid: orcid.trim() || null,
        is_pseudonym: isPseudonym,
      });
      await refresh();
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="stack">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-text" />
        <div className="skeleton skeleton-text" style={{ width: '60%' }} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Sign in required</p>
        <p className="empty-state-body">Log in to edit your profile settings.</p>
        <Link to="/login" className="btn btn-primary btn-sm">
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: '30rem' }}>
      <h1>Settings</h1>
      <div className="stack gap-1">
        <p className="small">
          <span className="muted">Username:</span> {user.username}
        </p>
        <p className="small">
          <span className="muted">Member since:</span> {user.created_at.slice(0, 10)}
        </p>
      </div>

      {error ? (
        <p className="small" role="alert" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="small" role="status" style={{ color: 'var(--color-success)' }}>
          Settings saved.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="stack" noValidate>
        <div className="field">
          <label htmlFor="set-display-name">Display name</label>
          <input
            id="set-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="set-bio">Bio</label>
          <textarea id="set-bio" value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="set-orcid">ORCID</label>
          <input
            id="set-orcid"
            type="text"
            value={orcid}
            onChange={(e) => setOrcid(e.target.value)}
            placeholder="0000-0002-1825-0097"
          />
          <p className="field-hint">Format: ####-####-####-####</p>
        </div>
        <div className="field">
          <label className="row items-center gap-2" htmlFor="set-pseudonym">
            <input
              id="set-pseudonym"
              type="checkbox"
              checked={isPseudonym}
              onChange={(e) => setIsPseudonym(e.target.checked)}
            />
            Contribute under a persistent pseudonym
          </label>
          <p className="field-hint">(§6.4 — build reputation without exposing legal identity)</p>
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: 0 }} />
      <AiCredentialSection />
    </div>
  );
}
