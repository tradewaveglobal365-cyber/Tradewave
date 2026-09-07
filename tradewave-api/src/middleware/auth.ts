import type { NextFunction, Request, Response } from 'express';
import type { Role, UserStatus } from '@prisma/client';
import { ACCESS_COOKIE } from '../lib/cookies';
import { verifyAccessToken } from '../services/token.service';
import { accountSuspended, emailNotVerified, forbidden, unauthorized } from '../lib/errors';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: { userId: string; role: Role; status: UserStatus; sessionId: string };
  }
}

/**
 * Reads the access token from the httpOnly cookie, falling back to a Bearer
 * header so the API stays testable with curl.
 */
function extractToken(req: Request): string | undefined {
  const fromCookie = req.cookies?.[ACCESS_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;

  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);

  return undefined;
}

/** Requires a valid access token. Does NOT check email verification. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) return next(unauthorized());

  const payload = verifyAccessToken(token);
  req.auth = {
    userId: payload.sub,
    role: payload.role,
    status: payload.status,
    sessionId: payload.sid,
  };
  next();
}

/**
 * Requires a fully active account.
 *
 * Account gating reads UserStatus in exactly one place so that when KYC lands it
 * becomes one more case here rather than a status check scattered across routes.
 */
export function requireActive(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(unauthorized());

  switch (req.auth.status) {
    case 'ACTIVE':
      return next();
    case 'PENDING_VERIFICATION':
      return next(emailNotVerified());
    case 'SUSPENDED':
      return next(accountSuspended());
    default:
      return next(forbidden());
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };
}
