// Upload an AI conversation. Two ways in:
//   1. Manual: paste a share link + the transcript text.
//   2. One-click: the bookmarklet (see BookmarkletHint) captures the open conversation in
//      the user's own browser and hands it to this same form pre-filled for review.
// Either way the server runs the matcher and returns AI-suggested work attachments, which
// the uploader reviews on the chat page — nothing is public until they verify (§4.1–4.2).

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AiCredentialStatus, ChatDetail, ChatPlatform } from '@shared/types';
import { CHAT_PLATFORMS } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';
import BookmarkletHint from '../components/BookmarkletHint';

export interface ChatUploadInitial {
  title?: string;
  url?: string;
  platform?: ChatPlatform | '';
  transcript?: string;
}

export default function ChatUploadPage({
  initial,
  captured = false,
}: {
  initial?: ChatUploadInitial;
  captured?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [title, setTitle] = useState(initial?.title ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [platform, setPlatform] = useState<ChatPlatform | ''>(initial?.platform ?? '');
  const [transcript, setTranscript] = useState(initial?.transcript ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only offer the "spend my key" consent when the user actually has a validated key.
  const [hasKey, setHasKey] = useState(false);
  const [aiConsent, setAiConsent] = useState(true);
  useEffect(() => {
    if (!user) return;
    api
      .get<{ credential: AiCredentialStatus }>('/api/me/ai-credentials')
      .then((r) => setHasKey(r.credential.present && r.credential.status === 'valid'))
      .catch(() => setHasKey(false));
  }, [user]);

  if (!user) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Log in to upload a conversation</p>
        <p className="empty-state-body">
          <Link to="/login">Log in</Link> or <Link to="/register">join</Link> — uploaded chats are tied to your
          account because you personally verify which works they attach to.
        </p>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ chat: ChatDetail }>('/api/chats', {
        title: title.trim() || undefined,
        url: url.trim() || undefined,
        platform: platform || undefined,
        transcript,
        ai_consent: hasKey ? aiConsent : undefined,
      });
      navigate(`/chats/${res.chat.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Upload failed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-5" style={{ maxWidth: '46rem' }}>
      <div className="stack gap-2">
        <h1>{captured ? 'Review captured conversation' : 'Upload a conversation'}</h1>
        {captured ? (
          <p className="muted">
            Captured from your browser. Review the transcript below and submit — the platform will then suggest
            which research works it relates to, and <strong>you</strong> confirm each before anything is public.
          </p>
        ) : (
          <p className="muted">
            Paste a chat you had with an AI (Claude, ChatGPT, Gemini, …). The platform reads the transcript and
            suggests which research works it relates to — <strong>you</strong> then confirm or reject each
            suggestion before anything becomes public.
          </p>
        )}
      </div>

      {!captured ? <BookmarkletHint /> : null}

      <form className="stack gap-3" onSubmit={(e) => void submit(e)} aria-label="Upload a conversation">
        <div className="field">
          <label htmlFor="chat-title">Title (optional)</label>
          <input
            id="chat-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. Discussing attention mechanisms with Claude"
          />
        </div>
        <div className="field">
          <label htmlFor="chat-url">Share link (optional)</label>
          <input
            id="chat-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://claude.ai/share/…"
          />
          <p className="field-hint">Kept as provenance so readers can view the original conversation.</p>
        </div>
        <div className="field">
          <label htmlFor="chat-platform">Platform</label>
          <select
            id="chat-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as ChatPlatform | '')}
          >
            <option value="">Auto-detect from link</option>
            {CHAT_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="chat-transcript">Conversation transcript</label>
          <textarea
            id="chat-transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={14}
            required
            placeholder="Paste the full conversation here…"
          />
          <p className="field-hint">
            At least 40 characters. DOIs and arXiv ids mentioned in the text are matched directly; the rest is
            matched by the AI layer and clearly labeled as such.
          </p>
        </div>
        {hasKey ? (
          <div className="field">
            <label className="row items-center gap-2" htmlFor="chat-ai-consent">
              <input
                id="chat-ai-consent"
                type="checkbox"
                checked={aiConsent}
                onChange={(e) => setAiConsent(e.target.checked)}
              />
              Use my Claude key to find related works
            </label>
            <p className="field-hint">
              Runs the AI match on your own Anthropic account (uses your credits). Uncheck to use the
              platform&rsquo;s default matcher instead. DOI/arXiv references are matched either way.
            </p>
          </div>
        ) : (
          <p className="field-hint">
            Want AI-powered matching on your own Claude account?{' '}
            <Link to="/settings">Add your API key in settings</Link>.
          </p>
        )}
        {error ? (
          <p className="small" style={{ color: 'var(--color-danger)' }}>
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Uploading & matching…' : 'Upload & find related works'}
        </button>
      </form>
    </div>
  );
}
