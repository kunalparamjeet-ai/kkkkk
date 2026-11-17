import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/store.ts';
import { sha256 } from '../lib/crypto.ts';
import type { UserRecord, UserRole } from '../types.ts';

export interface AuthenticatedRequest extends Request {
  user?: UserRecord;
  sessionId?: string;
}

export function extractSessionToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token && !token.startsWith('vk_live_')) {
      return token;
    }
  }
  const cookieToken = req.cookies?.vk_session;
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }
  return null;
}

export function resolveSessionUser(req: Request): { user: UserRecord; sessionId: string } | null {
  const token = extractSessionToken(req);
  if (!token) return null;
  const tokenHash = sha256(token);
  const db = getDb();
  const session = db.sessions.find((s) => s.tokenHash === tokenHash);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    return null;
  }
  const user = db.users.find((u) => u.id === session.userId);
  if (!user || user.status !== 'active') return null;
  return { user, sessionId: session.id };
}

export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const resolved = resolveSessionUser(req);
  if (resolved) {
    req.user = resolved.user;
    req.sessionId = resolved.sessionId;
  }
  next();
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const resolved = resolveSessionUser(req);
  if (!resolved) {
    res.status(401).json({ error: 'Authentication required. Please sign in to continue.' });
    return;
  }
  req.user = resolved.user;
  req.sessionId = resolved.sessionId;
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient permissions for this resource.' });
      return;
    }
    next();
  };
}
