// Bring-your-own Claude API key. The key is write-only: we POST it once, then only ever
// read back a status view (present?, last4, validation state) — the raw key never returns
// to the client. Used to run AI chat-matching / analysis billed to the user's own account.

import { useEffect, useState } from 'react';
import type { AiCredentialStatus } from '@shared/types';
import { api, ApiRequestError } from '../api';

export default function AiCredentialSection() {
  const [status, setStatus] = useState<AiCredentialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await api.get<{ credential: AiCredentialStatus }>('/api/me/ai-credentials');
      setStatus(res.credential);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'CREDENTIAL_STORAGE_UNAVAILABLE') {
        setUnavailable(true);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!keyInput.trim()) {
      setError('Paste your Anthropic API key.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.put<{ credential: AiCredentialStatus }>('/api/me/ai-credentials', {
        provider: 'anthropic',
        api_key: keyInput.trim(),
      });
      setStatus(res.credential);
      setKeyInput('');
      setNotice('Key saved and verified with Anthropic.');
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'CREDENTIAL_STORAGE_UNAVAILABLE') {
        setUnavailable(true);
      } else {
        setError(err instanceof ApiRequestError ? err.message : 'Failed to save key.');
      }
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async () => {
    setError(null);
    setNotice(null);
    setRemoving(true);
    try {
      await api.del('/api/me/ai-credentials');
      setStatus({ provider: 'anthropic', present: false, last4: null, status: 'unvalidated', validated_at: null });
      setNotice('Key removed.');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to remove key.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="stack gap-2">
      <div className="stack gap-1">
        <h2 style={{ margin: 0 }}>AI credentials</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Add your own Anthropic (Claude) API key to run AI-powered analysis — matching an uploaded chat to
          related works, and finding connections between papers — billed to your Anthropic account. The key is
          encrypted at rest and never shown again after you save it.
        </p>
      </div>

      {loading ? (
        <div className="skeleton skeleton-text" style={{ width: '50%' }} />
      ) : unavailable ? (
        <p className="small" role="status" style={{ color: 'var(--color-muted)' }}>
          Bring-your-own-key is not enabled on this server yet.
        </p>
      ) : (
        <>
          {status?.present ? (
            <div className="stack gap-1">
              <p className="small" style={{ margin: 0 }}>
                <span className="muted">Claude key:</span> ····{status.last4}{' '}
                <span
                  className="small"
                  style={{ color: status.status === 'valid' ? 'var(--color-success)' : 'var(--color-danger)' }}
                >
                  ({status.status})
                </span>
              </p>
              {status.validated_at ? (
                <p className="small muted" style={{ margin: 0 }}>
                  Verified {status.validated_at.slice(0, 10)}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              No key on file.
            </p>
          )}

          {error ? (
            <p className="small" role="alert" style={{ color: 'var(--color-danger)' }}>
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="small" role="status" style={{ color: 'var(--color-success)' }}>
              {notice}
            </p>
          ) : null}

          <form onSubmit={onSave} className="stack" noValidate>
            <div className="field">
              <label htmlFor="ai-key">{status?.present ? 'Replace key' : 'Anthropic API key'}</label>
              <input
                id="ai-key"
                type="password"
                autoComplete="off"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-ant-…"
              />
              <p className="field-hint">
                Create one at console.anthropic.com. We validate it before storing.
              </p>
            </div>
            <div className="row gap-2">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Verifying…' : status?.present ? 'Replace key' : 'Save key'}
              </button>
              {status?.present ? (
                <button type="button" className="btn" onClick={onRemove} disabled={removing}>
                  {removing ? 'Removing…' : 'Remove'}
                </button>
              ) : null}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
