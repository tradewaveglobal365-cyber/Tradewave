import type { NextFunction, Request, Response } from 'express';
import type { Role, UserStatus } from '@prisma/client';
import { ACCESS_COOKIE } from '../lib/cookies';
import { verifyAccessToken } from '../services/token.service';
import {
  accountSuspended,
  emailNotVerified,
  forbidden,
  kycPending,
  kycRequired,
  unauthorized,
} from '../lib/errors';
import { prisma } from '../lib/prisma';

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
 * Account gating reads UserStatus in exactly one place rather than scattering
 * status checks across routes.
 *
 * Identity verification is NOT folded in here — see requireKyc below. UserStatus
 * holds one value, and verifyEmail/resetPassword both write status: 'ACTIVE' as a
 * side effect, so encoding KYC in it would let a password reset silently change
 * someone's identity state.
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

/**
 * Requires a passed identity check.
 *
 * Reads the database rather than req.auth, unlike requireActive. kycStatus cannot
 * live in the access token: tokens last 15 minutes (ACCESS_TOKEN_TTL_SECONDS) and
 * a provider decision arrives by webhook, server-side, with no way to reissue the
 * user's token. Reading the JWT would leave someone who just passed verification
 * blocked for another quarter of an hour, which reads as a broken product. This
 * guards low-traffic write endpoints only, so the extra indexed SELECT is cheap
 * next to being correct.
 */
export async function requireKyc(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.auth) return next(unauthorized());

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    select: { kycStatus: true },
  });
  if (!user) return next(unauthorized());

  switch (user.kycStatus) {
    case 'VERIFIED':
      return next();
    case 'PENDING':
      return next(kycPending());
    case 'REJECTED':
      return next(
        kycRequired('Your last identity check did not pass. Please try again.'),
      );
    default:
      return next(kycRequired());
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };
}
