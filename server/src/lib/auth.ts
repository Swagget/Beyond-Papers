import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db.js';
import { unauthorized } from './errors.js';

export interface SessionUser {
  id: number;
  username: string;
  display_name: string;
  is_pseudonym: number;
  orcid: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const SESSION_DAYS = 30;

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
  ).run(token, userId);
  return token;
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function userForToken(token: string): SessionUser | undefined {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.is_pseudonym, u.orcid
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as SessionUser | undefined;
}

function tokenFromReq(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie = req.headers.cookie;
  if (cookie) {
    const match = /(?:^|;\s*)bp_session=([a-f0-9]+)/.exec(cookie);
    if (match) return match[1];
  }
  return null;
}

/** Attaches req.user when a valid session exists; never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = tokenFromReq(req);
  if (token) {
    const user = userForToken(token);
    if (user) req.user = user;
  }
  next();
}

/** Rejects with 401 when no valid session. Use on all write routes (§12.1: registration itself is open). */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(unauthorized());
    return;
  }
  next();
}

export const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
