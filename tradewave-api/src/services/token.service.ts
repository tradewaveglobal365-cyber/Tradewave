import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role, UserStatus } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { generateToken, hashToken } from '../lib/crypto';
import { logger } from '../lib/logger';
import { unauthorized } from '../lib/errors';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * How long after a rotation the old refresh token is still tolerated.
 *
 * Covers the window in which a second tab, a parallel request or a retried
 * navigation presents the token the first one has just replaced. Long enough to
 * absorb a slow mobile round trip, short enough that a replay hours later is
 * still caught as theft.
 */
export const REFRESH_ROTATION_GRACE_MS = 30_000;

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  status: UserStatus;
  sid: string;
}

export interface SessionContext {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'tradewave',
    audience: 'tradewave-web',
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: 'tradewave',
      audience: 'tradewave-web',
    });
    if (typeof decoded === 'string') throw new Error('Unexpected token payload');
    return {
      sub: String(decoded.sub),
      role: decoded.role as Role,
      status: decoded.status as UserStatus,
      sid: String(decoded.sid),
    };
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
}

/**
 * Starts a brand new session family (a fresh login).
 * Returns the RAW refresh token — the only time it exists outside the browser.
 */
export async function issueSession(userId: string, ctx: SessionContext) {
  const rawRefreshToken = generateToken();
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashToken(rawRefreshToken),
      familyId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      userAgent: ctx.userAgent ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
  });
  return { session, rawRefreshToken };
}

/**
 * Rotates a refresh token.
 *
 * The security-critical branch is REUSE DETECTION: a token that exists but is
 * already revoked has been replayed, which means someone captured it. We cannot
 * tell whether the replay came from the attacker or the honest user, so we
 * revoke the entire family and force a fresh login.
 */
export async function rotateRefreshToken(rawToken: string, ctx: SessionContext) {
  const tokenHash = hashToken(rawToken);

  const existing = await prisma.session.findUnique({
    where: { refreshTokenHash: tokenHash },
    include: { user: true },
  });

  if (!existing) throw unauthorized('Your session has expired. Please sign in again.');

  if (existing.revokedAt) {
    // A token that was rotated moments ago is a race, not a theft.
    //
    // Two tabs opened after the access token expired both refresh, and one of
    // them presents a token the other has already rotated. Treating that as
    // reuse revokes the whole family and signs the user out — punishing them
    // for having two tabs open. The grace window says: if this token was
    // retired seconds ago by a legitimate rotation and the family is still
    // alive, issue a new one instead of burning it all down.
    //
    // The security this gives up is narrow. An attacker replaying a stolen
    // token more than GRACE_MS after its rotation is still caught and still
    // kills the family; inside the window they would have to be racing the
    // real user, and they already hold an httpOnly cookie, which means they
    // have the session regardless.
    const rotatedAgo = Date.now() - existing.revokedAt.getTime();
    const familyAlive = await prisma.session.findFirst({
      where: { familyId: existing.familyId, revokedAt: null },
      select: { id: true },
    });

    if (rotatedAgo > REFRESH_ROTATION_GRACE_MS || !familyAlive) {
      await prisma.session.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      logger.warn(
        { userId: existing.userId, familyId: existing.familyId, ip: ctx.ipAddress },
        'Refresh token reuse detected — revoked entire session family',
      );
      throw unauthorized('Your session was ended for security reasons. Please sign in again.');
    }

    logger.info(
      { userId: existing.userId, familyId: existing.familyId, rotatedAgo },
      'Concurrent refresh inside the grace window — issuing a new token rather than revoking',
    );
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  const rawRefreshToken = generateToken();

  // Revoke the old row and mint the replacement atomically — a crash between
  // the two would otherwise leave a valid token the client never received.
  const [, session] = await prisma.$transaction([
    prisma.session.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    }),
    prisma.session.create({
      data: {
        userId: existing.userId,
        refreshTokenHash: hashToken(rawRefreshToken),
        familyId: existing.familyId, // same lineage
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
      },
    }),
  ]);

  return { session, rawRefreshToken, user: existing.user };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeSessionByToken(rawToken: string): Promise<void> {
  await prisma.session.updateMany({
    where: { refreshTokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}
