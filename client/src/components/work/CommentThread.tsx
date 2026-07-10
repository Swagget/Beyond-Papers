// Threaded, sub-unit-anchored comments (§5.4). Nested by parent_id;
// deleted comments keep their place in the thread with body '[deleted]'.

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Comment } from '@shared/types';
import { api, ApiRequestError } from '../../api';
import { useAuth } from '../../auth';

function errMsg(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.';
}

interface CommentThreadProps {
  workId: number;
  comments: Comment[];
  subunitId?: number;
  onChange: () => void;
}

export default function CommentThread({ workId, comments, subunitId, onChange }: CommentThreadProps) {
  const { user } = useAuth();
  const scoped = subunitId === undefined ? comments : comments.filter((c) => c.subunit_id === subunitId);
  const topLevel = scoped.filter((c) => c.parent_id === null);
  const childrenOf = (id: number) => scoped.filter((c) => c.parent_id === id);

  const [newBody, setNewBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  async function submitTop(e: FormEvent) {
    e.preventDefault();
    if (!newBody.trim()) return;
    setPosting(true);
    setPostError(null);
    try {
      await api.post(`/api/works/${workId}/comments`, { body: newBody.trim(), subunit_id: subunitId });
      setNewBody('');
      onChange();
    } catch (err) {
      setPostError(errMsg(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="stack gap-4">
      {topLevel.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">No comments yet</p>
          <p className="empty-state-body">Start the discussion below.</p>
        </div>
      ) : (
        <div className="comment-thread">
          {topLevel.map((c) => (
            <CommentNode key={c.id} comment={c} childrenOf={childrenOf} workId={workId} onChange={onChange} />
          ))}
        </div>
      )}

      {user ? (
        <form className="field" onSubmit={(e) => void submitTop(e)} aria-label="Add a comment">
          <label htmlFor="new-comment-body">Add a comment</label>
          <textarea id="new-comment-body" value={newBody} onChange={(e) => setNewBody(e.target.value)} required />
          {postError ? (
            <p className="small" style={{ color: 'var(--color-danger)' }}>
              {postError}
            </p>
          ) : null}
          <button className="btn btn-sm btn-primary" type="submit" disabled={posting} style={{ alignSelf: 'flex-start' }}>
            {posting ? 'Posting…' : 'Post comment'}
          </button>
        </form>
      ) : (
        <p className="small muted">
          <Link to="/login">Log in</Link> to comment.
        </p>
      )}
    </div>
  );
}

function CommentNode({
  comment,
  childrenOf,
  workId,
  onChange,
}: {
  comment: Comment;
  childrenOf: (id: number) => Comment[];
  workId: number;
  onChange: () => void;
}) {
  const { user } = useAuth();
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);

  const isDeleted = comment.deleted_at !== null;
  const isOwn = user?.id === comment.author_user_id;
  const kids = childrenOf(comment.id);

  async function submitReply(e: FormEvent) {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/works/${workId}/comments`, {
        body: replyBody.trim(),
        parent_id: comment.id,
        subunit_id: comment.subunit_id ?? undefined,
      });
      setReplyBody('');
      setReplying(false);
      onChange();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/comments/${comment.id}`, { body: editBody });
      setEditing(false);
      onChange();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this comment?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/comments/${comment.id}`);
      onChange();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="comment">
      <header className="comment-head">
        <span className="comment-author">
          {isDeleted ? 'deleted' : comment.author_name ?? `User #${comment.author_user_id}`}
        </span>
        <time className="comment-date" dateTime={comment.created_at.slice(0, 10)}>
          {comment.created_at.slice(0, 10)}
          {comment.edited_at ? ' (edited)' : ''}
        </time>
        {comment.subunit_id !== null ? (
          <a href={`#subunit-${comment.subunit_id}`} className="comment-anchor-ref">
            → Sub-unit #{comment.subunit_id}
          </a>
        ) : null}
      </header>

      {editing ? (
        <div className="field">
          <label htmlFor={`edit-comment-${comment.id}`} className="sr-only">
            Edit comment
          </label>
          <textarea id={`edit-comment-${comment.id}`} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
          <div className="row gap-2">
            <button className="btn btn-sm btn-primary" type="button" onClick={() => void saveEdit()} disabled={busy}>
              Save
            </button>
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => {
                setEditing(false);
                setEditBody(comment.body);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="comment-body">
          <p className={isDeleted ? 'muted' : undefined}>{isDeleted ? '[deleted]' : comment.body}</p>
        </div>
      )}

      {error ? (
        <p className="small" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      ) : null}

      {!isDeleted ? (
        <div className="comment-actions">
          {user ? (
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setReplying((r) => !r)}>
              Reply
            </button>
          ) : (
            <Link to="/login" className="small">
              Log in to reply
            </Link>
          )}
          {isOwn && !editing ? (
            <>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => void remove()} disabled={busy}>
                Delete
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {replying ? (
        <form className="field" onSubmit={(e) => void submitReply(e)} aria-label="Reply">
          <label htmlFor={`reply-${comment.id}`} className="sr-only">
            Reply
          </label>
          <textarea id={`reply-${comment.id}`} value={replyBody} onChange={(e) => setReplyBody(e.target.value)} required />
          <button className="btn btn-sm btn-primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-start' }}>
            {busy ? 'Posting…' : 'Post reply'}
          </button>
        </form>
      ) : null}

      {kids.length > 0 ? (
        <div className="comment-thread comment-thread-nested">
          {kids.map((k) => (
            <CommentNode key={k.id} comment={k} childrenOf={childrenOf} workId={workId} onChange={onChange} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
