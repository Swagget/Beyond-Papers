// Import receiver — the tab the capture bookmarklet opens. It performs the postMessage
// handshake (announce 'ready' to the opener, then accept one chat payload), and hands the
// captured conversation to the normal upload form for the user to review and submit.
//
// Trust model: we accept the payload from any opener origin (it's the user's own browser,
// on a page they chose), but the transcript is never uploaded automatically — the user
// still reviews it and clicks submit under their own Beyond-Papers session. We only read
// well-shaped 'beyond-papers-chat' messages and ignore everything else.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChatPlatform } from '@shared/types';
import { CHAT_PLATFORMS } from '@shared/types';
import ChatUploadPage, { type ChatUploadInitial } from './ChatUploadPage';

interface ChatPayload {
  type: 'beyond-papers-chat';
  platform?: string;
  title?: string;
  url?: string;
  transcript?: string;
}

function isChatPayload(d: unknown): d is ChatPayload {
  return (
    typeof d === 'object' &&
    d !== null &&
    (d as { type?: unknown }).type === 'beyond-papers-chat' &&
    typeof (d as { transcript?: unknown }).transcript === 'string'
  );
}

function normPlatform(p: unknown): ChatPlatform | '' {
  return typeof p === 'string' && (CHAT_PLATFORMS as string[]).includes(p) ? (p as ChatPlatform) : '';
}

export default function ChatImportPage() {
  const [initial, setInitial] = useState<ChatUploadInitial | null>(null);
  const receivedRef = useRef(false);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (receivedRef.current || !isChatPayload(e.data)) return;
      receivedRef.current = true;
      setInitial({
        title: e.data.title?.slice(0, 200) ?? '',
        url: e.data.url ?? '',
        platform: normPlatform(e.data.platform),
        transcript: e.data.transcript ?? '',
      });
      window.removeEventListener('message', onMessage);
    }
    window.addEventListener('message', onMessage);
    // Tell the opener (the bookmarklet) we're ready to receive. Opener origin is unknown
    // (claude.ai / chatgpt.com / …), and 'ready' carries nothing sensitive, so '*' is fine.
    if (window.opener) {
      try {
        window.opener.postMessage({ type: 'beyond-papers-ready' }, '*');
      } catch {
        /* opener closed or cross-origin restricted — user can still paste manually */
      }
    }
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!initial) {
    return (
      <div className="stack gap-3" style={{ maxWidth: '46rem' }}>
        <h1>Waiting for the conversation…</h1>
        <p className="muted">
          This tab was opened by the capture bookmarklet and is waiting to receive the conversation from your
          browser. If nothing appears within a few seconds, the page you clicked from may not be a supported
          chat, or pop-up messaging was blocked.
        </p>
        <p className="small muted">
          You can always <Link to="/chats/new">paste a conversation manually</Link> instead.
        </p>
      </div>
    );
  }

  return <ChatUploadPage initial={initial} captured />;
}
