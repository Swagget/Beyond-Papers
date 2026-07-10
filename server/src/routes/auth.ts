import { Router, type Request } from 'express';
import { db } from '../db.js';
import { wrapAsync, validationError, conflict, unauthorized } from '../lib/errors.js';
import {
  requireAuth,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  sessionCookie,
  ORCID_RE,
} from '../lib/auth.js';
import type { User } from '../../../shared/types.js';

// Mounted at /api/auth (spec §13.1). Register/login are pre-auth ('open'); logout/me require a session.
const router = Router();

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,40}$/;

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  is_pseudonym: number;
  orcid: string | null;
  bio: string | null;
  is_admin: number;
  created_at: string;
}

const USER_COLUMNS = 'id, username, display_name, is_pseudonym, orcid, bio, is_admin, created_at';

function toUser(row: Omit<UserRow, 'password_hash'>): User {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    is_pseudonym: !!row.is_pseudonym,
    orcid: row.orcid,
    bio: row.bio,
    is_admin: !!row.is_admin,
    created_at: row.created_at,
  };
}

/** Same cookie-then-Bearer resolution as lib/auth.ts's tokenFromReq (§19.4) — kept local per route-file isolation. */
function tokenFromReq(req: Request): string | null {
  const cookie = req.headers.cookie;
  if (cookie) {
    const match = /(?:^|;\s*)session_token=([a-f0-9]+)/.exec(cookie);
    if (match) return match[1];
  }
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

function clearCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

router.post(
  '/register',
  wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { username, password, display_name, is_pseudonym, orcid, bio } = body;

    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      throw validationError('username must be 3-40 characters of letters, digits, underscore, or hyphen');
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw validationError('password must be at least 8 characters');
    }
    if (typeof display_name !== 'string' || display_name.trim().length === 0) {
      throw validationError('display_name is required');
    }
    if (orcid !== undefined && orcid !== null && (typeof orcid !== 'string' || !ORCID_RE.test(orcid))) {
      throw validationError('orcid must match ####-####-####-###[X]');
    }
    if (is_pseudonym !== undefined && typeof is_pseudonym !== 'boolean') {
      throw validationError('is_pseudonym must be a boolean');
    }
    if (bio !== undefined && bio !== null && typeof bio !== 'string') {
      throw validationError('bio must be a string');
    }

    const usernameTaken = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (usernameTaken) throw conflict('Username already taken');

    if (orcid) {
      const orcidTaken = db.prepare('SELECT id FROM users WHERE orcid = ?').get(orcid as string);
      if (orcidTaken) throw conflict('ORCID already linked to another user');
    }

    const passwordHash = hashPassword(password);

    let userId: number;
    try {
      const result = db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, is_pseudonym, orcid, bio)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(username, passwordHash, display_name, is_pseudonym ? 1 : 0, (orcid as string | undefined) ?? null, (bio as string | undefined) ?? null);
      userId = Number(result.lastInsertRowid);
    } catch {
      // Race-safety net: UNIQUE(username)/UNIQUE(orcid) constraint hit between the check above and the insert.
      throw conflict('Username or ORCID already taken');
    }

    const row = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(userId) as Omit<UserRow, 'password_hash'>;
    const token = createSession(userId);
    res.setHeader('Set-Cookie', sessionCookie(token));
    res.status(201).json({ user: toUser(row), session_token: token });
  }),
);

router.post(
  '/login',
  wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { username, password } = body;

    if (typeof username !== 'string' || typeof password !== 'string') {
      throw unauthorized('Invalid username or password');
    }

    const row = db.prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE username = ?`).get(username) as
      | UserRow
      | undefined;
    // Same message whether the user doesn't exist or the password is wrong — never confirm username existence.
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw unauthorized('Invalid username or password');
    }

    const token = createSession(row.id);
    res.setHeader('Set-Cookie', sessionCookie(token));
    res.status(200).json({ user: toUser(row), session_token: token });
  }),
);

router.post(
  '/logout',
  requireAuth,
  wrapAsync(async (req, res) => {
    const token = tokenFromReq(req);
    if (token) destroySession(token);
    res.setHeader('Set-Cookie', clearCookie());
    res.status(204).end();
  }),
);

router.get(
  '/me',
  requireAuth,
  wrapAsync(async (req, res) => {
    if (!req.user) throw unauthorized();
    const row = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(req.user.id) as
      | Omit<UserRow, 'password_hash'>
      | undefined;
    if (!row) throw unauthorized();
    res.status(200).json({ user: toUser(row) });
  }),
);

export default router;
