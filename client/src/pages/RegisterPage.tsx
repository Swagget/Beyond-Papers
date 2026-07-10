import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { User } from '@shared/types';
import { useAuth } from '../auth';
import { api, ApiRequestError } from '../api';

const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export default function RegisterPage() {
  const { register, refresh } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isPseudonym, setIsPseudonym] = useState(false);
  const [orcid, setOrcid] = useState('');
  const [bio, setBio] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (orcid && !ORCID_PATTERN.test(orcid)) {
      setError('ORCID must look like 0000-0002-1825-0097.');
      return;
    }

    setSubmitting(true);
    try {
      await register(username, password, displayName, isPseudonym);
      // useAuth().register only accepts the four core fields — apply the
      // optional ones with a follow-up self-PATCH now that we're logged in.
      if (orcid || bio) {
        const me = await api.get<{ user: User }>('/api/auth/me');
        await api.patch(`/api/users/${me.user.id}`, {
          orcid: orcid || undefined,
          bio: bio || undefined,
        });
        await refresh();
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: '30rem', marginInline: 'auto' }}>
      <h1>Join Beyond Papers</h1>
      <p className="muted small">
        Registration is open to everyone — no invite or approval step (§12.1).
      </p>
      {error ? (
        <p className="small" role="alert" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="stack" noValidate>
        <div className="field">
          <label htmlFor="reg-username">Username</label>
          <input
            id="reg-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="reg-display-name">Display name</label>
          <input
            id="reg-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="reg-password">Password</label>
          <input
            id="reg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="field-hint">At least 8 characters.</p>
        </div>
        <div className="field">
          <label htmlFor="reg-confirm-password">Confirm password</label>
          <input
            id="reg-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label className="row items-center gap-2" htmlFor="reg-pseudonym">
            <input
              id="reg-pseudonym"
              type="checkbox"
              checked={isPseudonym}
              onChange={(e) => setIsPseudonym(e.target.checked)}
            />
            Contribute under a persistent pseudonym
          </label>
          <p className="field-hint">(§6.4 — build reputation without exposing legal identity)</p>
        </div>
        <div className="field">
          <label htmlFor="reg-orcid">ORCID (optional)</label>
          <input
            id="reg-orcid"
            type="text"
            value={orcid}
            onChange={(e) => setOrcid(e.target.value)}
            placeholder="0000-0002-1825-0097"
          />
          <p className="field-hint">Format: ####-####-####-####</p>
        </div>
        <div className="field">
          <label htmlFor="reg-bio">Bio (optional)</label>
          <textarea id="reg-bio" value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="small">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
