// Upload an AI conversation: paste a share link + the transcript. The server runs
// the matcher and returns AI-suggested work attachments, which the uploader then
// reviews on the chat page — nothing is public until they verify (§4.1–4.2 pattern).

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ChatDetail, ChatPlatform } from '@shared/types';
import { CHAT_PLATFORMS } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';

export default function ChatUploadPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState<ChatPlatform | ''>('');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <h1>Upload a conversation</h1>
        <p className="muted">
          Paste a chat you had with an AI (Claude, ChatGPT, Gemini, …). The platform reads the transcript and
          suggests which research works it relates to — <strong>you</strong> then confirm or reject each
          suggestion before anything becomes public. Share links can&rsquo;t be fetched automatically, so paste
          the conversation text itself below.
        </p>
      </div>

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
