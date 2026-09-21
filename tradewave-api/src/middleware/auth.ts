import type { NextFunction, Request, Response } from 'express';
import type { Role, UserStatus } from '@prisma/client';
import { ACCESS_COOKIE } from '../lib/cookies';
import { verifyAccessToken } from '../services/token.service';
import {
  accountRestricted,
  accountSuspended,
  emailNotVerified,
  forbidden,
  kycPending,
  kycRequired,
  unauthorized,
  withdrawalsBlocked,
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
 * Requires an account allowed to MOVE MONEY.
 *
 * Account gating reads UserStatus in exactly one place rather than scattering
 * status checks across routes.
 *
 * ── Reads the database, not the token ─────────────────────────────────────
 * This used to read req.auth.status, i.e. the JWT. That made every freeze up to
 * fifteen minutes late (ACCESS_TOKEN_TTL_SECONDS), and worse: the web proxy
 * silently calls /auth/refresh whenever a token is within 60s of expiring, so a
 * suspended session renewed itself indefinitely and the freeze never landed at
 * all. requireRole's comment below already made this argument for privilege;
 * it applies at least as strongly to somebody's money.
 *
 * ── What it does NOT guard ────────────────────────────────────────────────
 * Reading. A RESTRICTED investor can still see their balance, their holdings,
 * their ledger and their documents — that is the entire difference between
 * RESTRICTED and SUSPENDED, and it is why this is not on GET /portfolio.
 *
 * Identity verification is NOT folded in here — see requireKyc below. UserStatus
 * holds one value, and verifyEmail/resetPassword both write status: 'ACTIVE' as a
 * side effect, so encoding KYC in it would let a password reset silently change
 * someone's identity state.
 */
export async function requireActive(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.auth) return next(unauthorized());

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    select: { status: true },
  });
  if (!user) return next(unauthorized());

  switch (user.status) {
    case 'ACTIVE':
      return next();
    case 'PENDING_VERIFICATION':
      return next(emailNotVerified());
    case 'RESTRICTED':
      return next(accountRestricted());
    case 'SUSPENDED':
      return next(accountSuspended());
    default:
      return next(forbidden());
  }
}

/**
 * Requires that withdrawals are open for this investor.
 *
 * Separate from requireActive because it is narrower: blocking somebody from
 * taking money out while a payment is disputed should not also stop them
 * investing or reading their account. Mounted only on the withdrawal request
 * route; the admin approve path checks the same thing server-side, because a
 * withdrawal requested before the block still must not be paid after it.
 */
export async function requireWithdrawalsAllowed(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.auth) return next(unauthorized());

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    select: { withdrawalsBlockedAt: true },
  });
  if (!user) return next(unauthorized());
  if (user.withdrawalsBlockedAt) return next(withdrawalsBlocked());

  next();
}

/**
 * Requires a passed identity check.
 *
 * ⚠️ CURRENTLY WIRED TO NOTHING, on purpose.
 *
 * It used to guard investing, the deposit account, the payout account and
 * withdrawals. All four came off when identity verification stopped being a
 * condition of using the product: an investor who cannot finish a document
 * check is still an investor, and what verification gates now is referral
 * earnings, enforced on the money itself in wallet.service.debitSpendable
 * rather than at a door.
 *
 * Kept rather than deleted because one of those four may have to come back
 * quickly: whether Klasha's terms allow issuing a collection account to an
 * unverified customer was still open when the gates came off. Restoring it is
 * then one line in wallet.routes rather than a middleware to rebuild. If that
 * question resolves in our favour, delete this and kycPending with it.
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

/**
 * Requires one of the given roles.
 *
 * Reads the database rather than req.auth, for the same reason requireKyc does —
 * and more urgently. The access token carries the role it was issued with and
 * lives for 15 minutes (ACCESS_TOKEN_TTL_SECONDS), so trusting it would leave a
 * demoted admin holding admin for up to another quarter of an hour. That is the
 * window in which someone is removed for cause, or an account is believed
 * compromised, and revoking has to mean revoked now.
 *
 * Note the asymmetry with requireKyc: there, a stale token wrongly BLOCKS a user
 * who just passed. Here it wrongly GRANTS power to someone who just lost it. Both
 * arguments land on reading the database; only one of them is about privilege.
 *
 * This guards low-traffic admin routes, so the extra indexed SELECT is free next
 * to being correct.
 *
 * It also reads STATUS, not just role. A staff account frozen for cause used to
 * keep the entire admin console — including the ability to move money — because
 * this selected the role column and nothing else. Suspending somebody has to
 * mean they cannot act, and staff are the accounts where that matters most.
 */
export function requireRole(...roles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) return next(unauthorized());

    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { role: true, status: true },
    });
    if (!user) return next(unauthorized());
    if (user.status === 'SUSPENDED') return next(accountSuspended());
    if (user.status === 'RESTRICTED') return next(accountRestricted());
    if (!roles.includes(user.role)) return next(forbidden());

    next();
  };
}
