// The "drag this to your bookmarks bar" affordance for the capture bookmarklet.
// Rendered above the manual paste form as the faster, one-click alternative.

import { useMemo, useState } from 'react';
import { bookmarkletHref } from '../lib/bookmarklet';

export default function BookmarkletHint() {
  const [open, setOpen] = useState(false);
  const href = useMemo(() => bookmarkletHref(window.location.origin), []);

  return (
    <div
      className="stack gap-2"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius, 8px)',
        padding: '0.9rem 1rem',
        background: 'var(--color-surface, transparent)',
      }}
    >
      <div className="row items-center gap-2" style={{ justifyContent: 'space-between' }}>
        <strong>One-click capture</strong>
        <button type="button" className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'How it works'}
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Drag this button to your bookmarks bar, then click it while viewing any Claude, ChatGPT, or Gemini
        conversation — it copies the transcript straight from your browser into the form below. No copy-paste,
        no share link needed.
      </p>
      <p style={{ margin: 0 }}>
        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
        <a
          href={href}
          className="btn btn-primary btn-sm"
          onClick={(e) => e.preventDefault()}
          draggable
          title="Drag me to your bookmarks bar"
          style={{ cursor: 'grab' }}
        >
          📎 Send to Beyond-Papers
        </a>
      </p>
      {open ? (
        <ol className="small muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Show your browser&rsquo;s bookmarks bar (Ctrl/Cmd+Shift+B).</li>
          <li>Drag the “Send to Beyond-Papers” button onto it.</li>
          <li>Open a conversation on claude.ai, chatgpt.com, or gemini.google.com.</li>
          <li>Click the bookmark. A review tab opens here with the transcript filled in.</li>
        </ol>
      ) : null}
      <p className="small muted" style={{ margin: 0 }}>
        It runs entirely in your browser on a page you already have open — Beyond-Papers never fetches these
        sites itself, so nothing here bends any provider&rsquo;s terms of service.
      </p>
    </div>
  );
}
