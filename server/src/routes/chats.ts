// Uploaded AI conversations (chats) and their attachments to works.
//
// Trust model mirrors §4.1–4.2: on upload, the matcher proposes chat→work links as
// 'suggested' (AI origin, provenance-stamped). Only the uploader can confirm/reject
// each link, add manual links, and finally mark the chat 'verified'. Until verified,
// a chat is visible only to its uploader (and admins); work pages surface only
// confirmed links of verified chats.
//
// Mounted at /api by index.ts. Owns /chats... and /works/:id/chats.

import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { wrapAsync, validationError, notFound, forbidden, invalidTransition } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { sha256Hex } from '../lib/hash.js';
import { getWork } from '../services/workStore.js';
import { matchChatToWorks } from '../services/chatMatcher.js';
import { CHAT_PLATFORMS } from '../../../shared/types.js';
import type {
  Chat,
  ChatDetail,
  ChatLink,
  ChatLinkDetail,
  ChatPlatform,
  ChatSummary,
  WorkChat,
} from '../../../shared/types.js';

const router = Router();

const MIN_TRANSCRIPT_CHARS = 40;
const MAX_TRANSCRIPT_CHARS = 500_000;
const MAX_TITLE_CHARS = 200;
const MAX_URL_CHARS = 2000;

// ---------- helpers ----------

type ChatRow = Chat & { uploader_name: string };

function getChatRow(id: number): ChatRow | undefined {
  return db
    .prepare(
      `SELECT c.*, u.display_name AS uploader_name
       FROM chats c JOIN users u ON u.id = c.uploaded_by
       WHERE c.id = ?`,
    )
    .get(id) as ChatRow | undefined;
}

function chatLinks(chatId: number): ChatLinkDetail[] {
  return db
    .prepare(
      `SELECT l.*, w.title AS work_title, w.kind AS work_kind
       FROM chat_links l JOIN works w ON w.id = l.work_id
       WHERE l.chat_id = ?
       ORDER BY l.status = 'confirmed' DESC, l.confidence DESC, l.id`,
    )
    .all(chatId) as ChatLinkDetail[];
}

function chatDetail(row: ChatRow): ChatDetail {
  return { ...row, links: chatLinks(row.id) };
}

/** Pending chats exist only for their uploader (404 for everyone else — don't leak). */
function requireVisibleChat(id: number, userId: number | null, isAdmin: boolean): ChatRow {
  const chat = getChatRow(id);
  if (!chat) throw notFound('Chat not found');
  if (chat.status !== 'verified' && chat.uploaded_by !== userId && !isAdmin) {
    throw notFound('Chat not found');
  }
  return chat;
}

function requireUploader(chat: ChatRow, userId: number): void {
  if (chat.uploaded_by !== userId) {
    throw forbidden('Only the uploader can verify or edit this chat');
  }
}

function inferPlatform(url: string | null): ChatPlatform {
  if (!url) return 'other';
  if (/claude\.ai|anthropic\.com/i.test(url)) return 'claude';
  if (/chatgpt\.com|chat\.openai\.com|openai\.com/i.test(url)) return 'chatgpt';
  if (/gemini\.google|bard\.google/i.test(url)) return 'gemini';
  return 'other';
}

// ---------- routes ----------

// POST /api/chats — upload a conversation; matcher runs inline and returns suggestions.
router.post(
  '/chats',
  requireAuth,
  wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    if (transcript.length < MIN_TRANSCRIPT_CHARS) {
      throw validationError(`transcript is required (at least ${MIN_TRANSCRIPT_CHARS} characters)`);
    }
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      throw validationError(`transcript exceeds the ${MAX_TRANSCRIPT_CHARS}-character limit`);
    }

    let url: string | null = null;
    if (body.url !== undefined && body.url !== null && body.url !== '') {
      if (typeof body.url !== 'string' || body.url.length > MAX_URL_CHARS || !/^https?:\/\//i.test(body.url)) {
        throw validationError('url must be an http(s) URL');
      }
      url = body.url.trim();
    }

    let platform: ChatPlatform;
    if (body.platform === undefined || body.platform === null || body.platform === '') {
      platform = inferPlatform(url);
    } else if (typeof body.platform === 'string' && (CHAT_PLATFORMS as string[]).includes(body.platform)) {
      platform = body.platform as ChatPlatform;
    } else {
      throw validationError(`platform must be one of ${CHAT_PLATFORMS.join(', ')}`);
    }

    let title: string;
    if (typeof body.title === 'string' && body.title.trim()) {
      if (body.title.trim().length > MAX_TITLE_CHARS) {
        throw validationError(`title exceeds ${MAX_TITLE_CHARS} characters`);
      }
      title = body.title.trim();
    } else {
      const firstLine = transcript.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? 'Conversation';
      title = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
    }

    const info = db
      .prepare(
        `INSERT INTO chats (url, platform, title, transcript, content_hash, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(url, platform, title, transcript, sha256Hex(transcript), req.user!.id);
    const chatId = Number(info.lastInsertRowid);

    // Matcher runs after the insert; a matcher failure must not lose the upload.
    let suggestions: Awaited<ReturnType<typeof matchChatToWorks>> = [];
    try {
      suggestions = await matchChatToWorks(transcript);
    } catch (err) {
      console.error('chat matcher failed:', err);
    }
    const insertLink = db.prepare(
      `INSERT OR IGNORE INTO chat_links (chat_id, work_id, origin, model, model_version, confidence, basis, status)
       VALUES (?, ?, 'ai', ?, ?, ?, ?, 'suggested')`,
    );
    for (const s of suggestions) {
      insertLink.run(chatId, s.work_id, s.model, s.model_version, s.confidence, s.basis);
    }

    res.status(201).json({ chat: chatDetail(getChatRow(chatId)!) });
  }),
);

// GET /api/chats — verified chats (public); ?mine=true lists the caller's own, any status.
router.get(
  '/chats',
  wrapAsync(async (req, res) => {
    const mine = req.query.mine === 'true';
    if (mine && !req.user) throw validationError('mine=true requires authentication');
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where = mine ? 'c.uploaded_by = ?' : `c.status = 'verified'`;
    const params: unknown[] = mine ? [req.user!.id] : [];

    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM chats c WHERE ${where}`).get(...params) as { c: number }
    ).c;
    const items = db
      .prepare(
        `SELECT c.id, c.url, c.platform, c.title, c.content_hash, c.uploaded_by, c.status,
                c.verified_at, c.created_at, u.display_name AS uploader_name,
                (SELECT COUNT(*) FROM chat_links l WHERE l.chat_id = c.id AND l.status = 'confirmed') AS confirmed_link_count,
                (SELECT COUNT(*) FROM chat_links l WHERE l.chat_id = c.id AND l.status = 'suggested') AS suggested_link_count
         FROM chats c JOIN users u ON u.id = c.uploaded_by
         WHERE ${where}
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ChatSummary[];

    res.json({ items, total, limit, offset });
  }),
);

// GET /api/chats/:id
router.get(
  '/chats/:id',
  wrapAsync(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw validationError('id must be a positive integer');
    const chat = requireVisibleChat(id, req.user?.id ?? null, !!req.user?.is_admin);
    res.json({ chat: chatDetail(chat) });
  }),
);

// POST /api/chats/:id/links — uploader manually attaches a work (human origin, instantly confirmed).
router.post(
  '/chats/:id/links',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw validationError('id must be a positive integer');
    const chat = requireVisibleChat(id, req.user!.id, !!req.user!.is_admin);
    requireUploader(chat, req.user!.id);

    const workId = Number((req.body ?? {}).work_id);
    if (!Number.isInteger(workId) || workId <= 0) throw validationError('work_id must be a positive integer');
    if (!getWork(workId)) throw notFound('Work not found');

    const existing = db
      .prepare('SELECT * FROM chat_links WHERE chat_id = ? AND work_id = ?')
      .get(id, workId) as ChatLink | undefined;

    if (existing) {
      // An uploader re-adding a suggested/rejected link is a confirmation of it.
      db.prepare(
        `UPDATE chat_links SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?`,
      ).run(req.user!.id, nowIso(), existing.id);
    } else {
      db.prepare(
        `INSERT INTO chat_links (chat_id, work_id, origin, status, confirmed_by, confirmed_at)
         VALUES (?, ?, 'human', 'confirmed', ?, ?)`,
      ).run(id, workId, req.user!.id, nowIso());
    }

    res.status(201).json({ chat: chatDetail(chat) });
  }),
);

// POST /api/chats/:id/links/:linkId/confirm | /reject — uploader resolves a suggestion.
function resolveLink(action: 'confirm' | 'reject') {
  return wrapAsync(async (req: import('express').Request, res: import('express').Response) => {
    const id = Number(req.params.id);
    const linkId = Number(req.params.linkId);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(linkId) || linkId <= 0) {
      throw validationError('id and linkId must be positive integers');
    }
    const chat = requireVisibleChat(id, req.user!.id, !!req.user!.is_admin);
    requireUploader(chat, req.user!.id);

    const link = db
      .prepare('SELECT * FROM chat_links WHERE id = ? AND chat_id = ?')
      .get(linkId, id) as ChatLink | undefined;
    if (!link) throw notFound('Link not found');

    const target = action === 'confirm' ? 'confirmed' : 'rejected';
    if (link.status === target) throw invalidTransition(`Link is already ${target}`);

    if (action === 'confirm') {
      db.prepare(
        `UPDATE chat_links SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?`,
      ).run(req.user!.id, nowIso(), linkId);
    } else {
      db.prepare(
        `UPDATE chat_links SET status = 'rejected', confirmed_by = NULL, confirmed_at = NULL WHERE id = ?`,
      ).run(linkId);
    }

    res.json({ chat: chatDetail(chat) });
  });
}
router.post('/chats/:id/links/:linkId/confirm', requireAuth, resolveLink('confirm'));
router.post('/chats/:id/links/:linkId/reject', requireAuth, resolveLink('reject'));

// POST /api/chats/:id/verify — uploader attests review; every suggestion must be resolved first.
router.post(
  '/chats/:id/verify',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw validationError('id must be a positive integer');
    const chat = requireVisibleChat(id, req.user!.id, !!req.user!.is_admin);
    requireUploader(chat, req.user!.id);
    if (chat.status === 'verified') throw invalidTransition('Chat is already verified');

    const pending = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM chat_links WHERE chat_id = ? AND status = 'suggested'`)
        .get(id) as { c: number }
    ).c;
    if (pending > 0) {
      throw invalidTransition(
        `Resolve all suggested links first (${pending} still pending) — confirm or reject each one.`,
      );
    }

    db.prepare(`UPDATE chats SET status = 'verified', verified_at = ? WHERE id = ?`).run(nowIso(), id);
    res.json({ chat: chatDetail(getChatRow(id)!) });
  }),
);

// DELETE /api/chats/:id — uploader or admin.
router.delete(
  '/chats/:id',
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw validationError('id must be a positive integer');
    const chat = requireVisibleChat(id, req.user!.id, !!req.user!.is_admin);
    if (chat.uploaded_by !== req.user!.id && !req.user!.is_admin) {
      throw forbidden('Only the uploader or an admin can delete this chat');
    }
    db.prepare('DELETE FROM chats WHERE id = ?').run(id);
    res.status(204).end();
  }),
);

// GET /api/works/:id/chats — verified chats confirmed-linked to this work. Public.
router.get(
  '/works/:id/chats',
  wrapAsync(async (req, res) => {
    const workId = Number(req.params.id);
    if (!Number.isInteger(workId) || workId <= 0) throw validationError('id must be a positive integer');
    if (!getWork(workId)) throw notFound('Work not found');

    const rows = db
      .prepare(
        `SELECT c.id AS chat_id, c.url, c.platform, c.title, c.content_hash, c.uploaded_by,
                c.status AS chat_status, c.verified_at, c.created_at AS chat_created_at,
                u.display_name AS uploader_name,
                l.id AS link_id, l.origin, l.model, l.model_version, l.confidence, l.basis,
                l.status AS link_status, l.confirmed_by, l.confirmed_at, l.created_at AS link_created_at
         FROM chat_links l
         JOIN chats c ON c.id = l.chat_id
         JOIN users u ON u.id = c.uploaded_by
         WHERE l.work_id = ? AND l.status = 'confirmed' AND c.status = 'verified'
         ORDER BY c.verified_at DESC`,
      )
      .all(workId) as Record<string, unknown>[];

    const items: WorkChat[] = rows.map((r) => ({
      chat: {
        id: r.chat_id as number,
        url: r.url as string | null,
        platform: r.platform as ChatPlatform,
        title: r.title as string,
        content_hash: r.content_hash as string,
        uploaded_by: r.uploaded_by as number,
        uploader_name: r.uploader_name as string,
        status: r.chat_status as Chat['status'],
        verified_at: r.verified_at as string | null,
        created_at: r.chat_created_at as string,
      },
      link: {
        id: r.link_id as number,
        chat_id: r.chat_id as number,
        work_id: workId,
        origin: r.origin as ChatLink['origin'],
        model: r.model as string | null,
        model_version: r.model_version as string | null,
        confidence: r.confidence as number | null,
        basis: r.basis as string | null,
        status: r.link_status as ChatLink['status'],
        confirmed_by: r.confirmed_by as number | null,
        confirmed_at: r.confirmed_at as string | null,
        created_at: r.link_created_at as string,
      },
    }));

    res.json({ items });
  }),
);

export default router;
