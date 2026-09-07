import { Prisma, type User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { generateReferralCode, generateToken, hashToken } from '../../lib/crypto';
import { burnTimingBudget, hashPassword, verifyPassword } from '../../lib/password';
import {
  accountLocked,
  accountSuspended,
  invalidCredentials,
  invalidToken,
  notFound,
} from '../../lib/errors';
import { emailService } from '../../services/email';
import { withMinimumDuration } from '../../lib/timing';
import {
  issueSession,
  revokeAllSessions,
  signAccessToken,
  type SessionContext,
} from '../../services/token.service';
import type { LoginInput, RegisterInput } from './schemas';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const REFERRAL_CODE_MAX_ATTEMPTS = 5;
/** Floor for endpoints that must not leak account existence via latency. */
const ENUMERATION_FLOOR_MS = 250;

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  country: string;
  status: User['status'];
  role: User['role'];
  emailVerified: boolean;
  kycStatus: User['kycStatus'];
  referralCode: string;
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    country: user.country,
    status: user.status,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    kycStatus: user.kycStatus,
    referralCode: user.referralCode,
    createdAt: user.createdAt,
  };
}

const verifyUrl = (token: string) => `${env.WEB_ORIGIN}/verify-email?token=${token}`;
const resetUrl = (token: string) => `${env.WEB_ORIGIN}/reset-password?token=${token}`;
const loginUrl = () => `${env.WEB_ORIGIN}/login`;

/** Mints a verification/reset token and stores only its hash. */
async function createVerificationToken(
  userId: string,
  type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
  ttlMs: number,
): Promise<string> {
  const raw = generateToken();
  await prisma.verificationToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      type,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return raw;
}

/**
 * Registration.
 *
 * Returns the same shape whether or not the email was already taken — the
 * response must not tell an attacker which addresses have accounts. A real
 * duplicate gets an email saying "you already have an account" instead.
 */
export async function register(input: RegisterInput): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });

  if (existing) {
    const resetToken = await createVerificationToken(
      existing.id,
      'PASSWORD_RESET',
      PASSWORD_RESET_TTL_MS,
    );
    await emailService.sendDuplicateSignupNotice({
      to: existing.email,
      firstName: existing.firstName,
      loginUrl: loginUrl(),
      resetUrl: resetUrl(resetToken),
    });
    return;
  }

  const passwordHash = await hashPassword(input.password);

  // Resolved before the transaction so a bad code costs nothing. An
  // unrecognised code is deliberately ignored rather than rejected: a broken
  // referral link must never be the reason a signup fails.
  const referrer = input.referralCode
    ? await prisma.user.findUnique({
        where: { referralCode: input.referralCode },
        select: { id: true, status: true },
      })
    : null;

  if (input.referralCode && !referrer) {
    logger.info({ code: input.referralCode }, 'Signup used an unrecognised referral code');
  }

  const referredById = referrer && referrer.status !== 'SUSPENDED' ? referrer.id : null;

  const user = await createUserWithUniqueReferralCode({
    email: input.email,
    passwordHash,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone ?? null,
    country: input.country,
    referredById,
    referredAt: referredById ? new Date() : null,
  });

  const token = await createVerificationToken(
    user.id,
    'EMAIL_VERIFICATION',
    EMAIL_VERIFICATION_TTL_MS,
  );

  await emailService.sendVerification({
    to: user.email,
    firstName: user.firstName,
    verifyUrl: verifyUrl(token),
  });
}

/**
 * Referral codes are random, so collisions are possible but rare. Rather than
 * check-then-insert (which races), we let the unique constraint arbitrate and
 * retry on violation.
 */
async function createUserWithUniqueReferralCode(
  data: Omit<Prisma.UserUncheckedCreateInput, 'referralCode'>,
): Promise<User> {
  for (let attempt = 1; attempt <= REFERRAL_CODE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.user.create({
        data: { ...data, referralCode: generateReferralCode() },
      });
    } catch (err) {
      const isCodeCollision =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        (err.meta?.target as string[] | undefined)?.includes('referralCode');

      if (!isCodeCollision || attempt === REFERRAL_CODE_MAX_ATTEMPTS) throw err;
      logger.warn({ attempt }, 'Referral code collision, retrying');
    }
  }
  throw new Error('Unreachable: referral code retry loop exhausted');
}

export async function verifyEmail(rawToken: string, ctx: SessionContext) {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });

  if (!record || record.type !== 'EMAIL_VERIFICATION') throw invalidToken();
  if (record.consumedAt) throw invalidToken('This link has already been used.');
  if (record.expiresAt.getTime() <= Date.now()) {
    throw invalidToken('This link has expired. Request a new one.');
  }
  if (record.user.status === 'SUSPENDED') throw accountSuspended();

  const [, user] = await prisma.$transaction([
    prisma.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: {
        status: 'ACTIVE',
        emailVerifiedAt: record.user.emailVerifiedAt ?? new Date(),
      },
    }),
  ]);

  // Verifying logs the user straight in — bouncing a freshly-verified user to a
  // login form is friction with no security benefit.
  return startSession(user, ctx);
}

export async function resendVerification(email: string): Promise<void> {
  await withMinimumDuration(ENUMERATION_FLOOR_MS, async () => {
    const user = await prisma.user.findUnique({ where: { email } });

    // Silent no-op for unknown or already-verified accounts (no enumeration).
    if (!user || user.emailVerifiedAt || user.status === 'SUSPENDED') return;

    const token = await createVerificationToken(
      user.id,
      'EMAIL_VERIFICATION',
      EMAIL_VERIFICATION_TTL_MS,
    );
    await emailService.sendVerification({
      to: user.email,
      firstName: user.firstName,
      verifyUrl: verifyUrl(token),
    });
  });
}

export async function login(input: LoginInput, ctx: SessionContext) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    // Spend the same time we would on a real verify so response latency does
    // not reveal whether the account exists.
    await burnTimingBudget(input.password);
    await recordAttempt(input.email, ctx, false);
    throw invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw accountLocked(user.lockedUntil);
  }

  if (user.status === 'SUSPENDED') throw accountSuspended();

  const ok = await verifyPassword(user.passwordHash, input.password);

  if (!ok) {
    const failed = user.failedLoginCount + 1;
    const shouldLock = failed >= MAX_FAILED_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : failed,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
      },
    });
    await recordAttempt(input.email, ctx, false);
    if (shouldLock) throw accountLocked(new Date(Date.now() + LOCK_DURATION_MS));
    throw invalidCredentials();
  }

  const fresh = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await recordAttempt(input.email, ctx, true);
  return startSession(fresh, ctx);
}

async function recordAttempt(email: string, ctx: SessionContext, success: boolean): Promise<void> {
  try {
    await prisma.loginAttempt.create({
      data: { email, ipAddress: ctx.ipAddress ?? 'unknown', success },
    });
  } catch (err) {
    // Audit logging must never break the login path.
    logger.warn({ err }, 'Failed to record login attempt');
  }
}

/** Issues a session plus a signed access token for a user. */
export async function startSession(user: User, ctx: SessionContext) {
  const { session, rawRefreshToken } = await issueSession(user.id, ctx);
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    status: user.status,
    sid: session.id,
  });
  return { user, accessToken, refreshToken: rawRefreshToken };
}

/**
 * Always resolves, whether or not the email exists. The caller returns 200
 * unconditionally so this endpoint cannot be used to discover accounts.
 */
export async function forgotPassword(email: string): Promise<void> {
  await withMinimumDuration(ENUMERATION_FLOOR_MS, async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.status === 'SUSPENDED') return;

    const token = await createVerificationToken(user.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_MS);
    await emailService.sendPasswordReset({
      to: user.email,
      firstName: user.firstName,
      resetUrl: resetUrl(token),
    });
  });
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });

  if (!record || record.type !== 'PASSWORD_RESET') throw invalidToken();
  if (record.consumedAt) throw invalidToken('This link has already been used.');
  if (record.expiresAt.getTime() <= Date.now()) {
    throw invalidToken('This link has expired. Request a new one.');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        // A reset also clears the "unverified" state: possession of the inbox
        // is exactly what verification was proving.
        status: record.user.status === 'PENDING_VERIFICATION' ? 'ACTIVE' : record.user.status,
        emailVerifiedAt: record.user.emailVerifiedAt ?? new Date(),
      },
    }),
    // Anyone who had a session on this account loses it. If the reset was
    // triggered by a compromise, this is what evicts the attacker.
    prisma.session.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    // Burn any other outstanding reset links for this user.
    prisma.verificationToken.updateMany({
      where: { userId: record.userId, type: 'PASSWORD_RESET', consumedAt: null },
      data: { consumedAt: new Date() },
    }),
  ]);
}

export async function getUserById(userId: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Account not found.');
  return user;
}

export { revokeAllSessions };
