import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db.js';
import { unauthorized, forbidden } from './errors.js';

export interface SessionUser {
  id: number;
  username: string;
  display_name: string;
  is_pseudonym: number;
  orcid: string | null;
  is_admin: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

// scrypt params per spec §6; stored as "scrypt:<N>:<r>:<p>:<saltHex>:<hashHex>".
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString('hex');
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, salt, hash] = parts;
  const candidate = scryptSync(password, salt, KEYLEN, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now', '+${SESSION_TTL_DAYS} days'))`,
  ).run(token, userId);
  return token;
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `session_token=${token}; HttpOnly; SameSite=Lax; Path=/${secure}`;
}

function userForToken(token: string): SessionUser | undefined {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.is_pseudonym, u.orcid, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .get(token) as SessionUser | undefined;
}

/** Cookie 'session_token' checked first, then 'Authorization: Bearer <token>' (spec §6). */
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

/** Attaches req.user when a valid session exists; never rejects. Mounted globally. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = tokenFromReq(req);
  if (token) {
    const user = userForToken(token);
    if (user) req.user = user;
  }
  next();
}

/** 401 when no valid session. Use on all write routes (§12.1: registration itself is open). */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(unauthorized());
    return;
  }
  next();
}

/** Chain after requireAuth. 403 unless users.is_admin. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(unauthorized());
    return;
  }
  if (!req.user.is_admin) {
    next(forbidden('Admin privileges required'));
    return;
  }
  next();
}

export const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
