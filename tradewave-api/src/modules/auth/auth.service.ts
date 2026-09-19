import { Prisma, type KycStatus, type User } from '@prisma/client';
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
  validationFailed,
} from '../../lib/errors';
import { emailService } from '../../services/email';
import { withMinimumDuration } from '../../lib/timing';
import { describeDevice, describeWhen } from '../../lib/device';
import {
  issueSession,
  revokeAllSessions,
  signAccessToken,
  type SessionContext,
} from '../../services/token.service';
import { formatBonusRate } from '../referral/referral.service';
import type { LoginInput, RegisterInput, UpdateProfileInput } from './schemas';

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
    try {
      await emailService.sendDuplicateSignupNotice({
        to: existing.email,
        firstName: existing.firstName,
        loginUrl: loginUrl(),
        resetUrl: resetUrl(resetToken),
      });
    } catch (err) {
      logger.error({ err, userId: existing.id }, 'Could not send the duplicate signup email');
    }
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

  // Never allowed to throw. The user row is already committed, so a rejection
  // that escaped here would 500 a registration that in fact succeeded — and the
  // retry would find the address taken and send "you already have an account"
  // instead of a link, stranding somebody who can neither verify nor re-register.
  try {
    await emailService.sendVerification({
      to: user.email,
      firstName: user.firstName,
      verifyUrl: verifyUrl(token),
    });
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Could not send the verification email');
  }
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

  // Whether this is the moment the account became real, as opposed to a second
  // unconsumed token being spent on an address already confirmed. Read before
  // the update, which is what overwrites it.
  const firstVerification = record.user.emailVerifiedAt === null;

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

  // After the commit, never inside it, and never allowed to throw — an email
  // that fails must not undo a verification that succeeded.
  if (firstVerification) await notifyVerified(user);

  // Verifying logs the user straight in — bouncing a freshly-verified user to a
  // login form is friction with no security benefit.
  return startSession(user, ctx);
}

/**
 * The two emails a confirmed address earns: a welcome for the investor, and a
 * note to whoever referred them.
 *
 * Both wait for verification rather than firing at signup, because an address
 * nobody has confirmed is not yet a person — telling a referrer they have an
 * invitee on the strength of an unverified signup is how a referral count gets
 * gamed with addresses that do not exist.
 */
async function notifyVerified(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  referredById: string | null;
}): Promise<void> {
  try {
    await emailService.sendWelcome({
      to: user.email,
      firstName: user.firstName,
      url: `${env.WEB_ORIGIN}/verify-identity`,
    });
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Could not send the welcome email');
  }

  if (!user.referredById) return;

  try {
    const referrer = await prisma.user.findUnique({
      where: { id: user.referredById },
      select: { email: true, firstName: true, status: true },
    });
    // A suspended referrer is skipped, the same rule the bonus itself follows.
    if (!referrer || referrer.status === 'SUSPENDED') return;

    await emailService.sendReferralSignup({
      to: referrer.email,
      firstName: referrer.firstName,
      // Masked exactly as /referrals masks it: referring somebody is not a
      // reason to be handed their full name.
      inviteeName: `${user.firstName} ${user.lastName.charAt(0)}.`,
      rate: formatBonusRate(),
      url: `${env.WEB_ORIGIN}/referrals`,
    });
  } catch (err) {
    logger.error({ err, referrerId: user.referredById }, 'Could not send the referral signup email');
  }
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
    // Swallowed for the same reason the unknown-address case returns silently:
    // this endpoint must answer identically whichever address it is given.
    try {
      await emailService.sendVerification({
        to: user.email,
        firstName: user.firstName,
        verifyUrl: verifyUrl(token),
      });
    } catch (err) {
      logger.error({ err, userId: user.id }, 'Could not resend the verification email');
    }
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
    if (shouldLock) {
      const until = new Date(Date.now() + LOCK_DURATION_MS);
      // The account owner is the one person who cannot see these attempts, and
      // a lock they were not told about reads as the site being broken. Sent to
      // a confirmed address only: an unverified one may not be theirs.
      if (user.emailVerifiedAt) {
        try {
          await emailService.sendAccountLocked({
            to: user.email,
            firstName: user.firstName,
            minutes: Math.round(LOCK_DURATION_MS / 60_000),
            resetUrl: `${env.WEB_ORIGIN}/forgot-password`,
          });
        } catch (err) {
          logger.error({ err, userId: user.id }, 'Could not send the account locked email');
        }
      }
      throw accountLocked(until);
    }
    throw invalidCredentials();
  }

  // Asked BEFORE startSession, which is about to store a session carrying this
  // very user-agent — after it, every device looks familiar to itself.
  const unseen = await isUnseenDevice(user.id, ctx.userAgent);

  const fresh = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await recordAttempt(input.email, ctx, true);
  const session = await startSession(fresh, ctx);

  if (unseen) {
    try {
      await emailService.sendNewDeviceSignIn({
        to: fresh.email,
        firstName: fresh.firstName,
        device: describeDevice(ctx.userAgent),
        when: describeWhen(new Date()),
        resetUrl: `${env.WEB_ORIGIN}/forgot-password`,
      });
    } catch (err) {
      logger.error({ err, userId: fresh.id }, 'Could not send the new device email');
    }
  }

  return session;
}

/**
 * Whether this user-agent has ever signed this account in before.
 *
 * Revoked and expired sessions still count: revokeAllSessions only stamps
 * revokedAt, so the row survives as history, and a device is no less familiar
 * for having been signed out of.
 *
 * Two deliberate silences. A request with no user-agent tells us nothing, and a
 * guess either way is worse than nothing. An account with no sessions at all is
 * signing in for the very first time — everything is new, and "we noticed a new
 * sign-in" moments after signing up teaches people to ignore the warning.
 */
async function isUnseenDevice(userId: string, userAgent?: string): Promise<boolean> {
  if (!userAgent) return false;
  try {
    const [everSignedIn, thisDevice] = await Promise.all([
      prisma.session.findFirst({ where: { userId }, select: { id: true } }),
      prisma.session.findFirst({ where: { userId, userAgent }, select: { id: true } }),
    ]);
    return everSignedIn !== null && thisDevice === null;
  } catch (err) {
    // A lookup failure must never be the reason a correct password is refused.
    logger.warn({ err, userId }, 'Could not check whether this device is known');
    return false;
  }
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
    // Must not throw: an error here escapes as a 500 for addresses that exist
    // while unknown ones still return 200, which is exactly the account oracle
    // the minimum-duration floor above exists to close.
    try {
      await emailService.sendPasswordReset({
        to: user.email,
        firstName: user.firstName,
        resetUrl: resetUrl(token),
      });
    } catch (err) {
      logger.error({ err, userId: user.id }, 'Could not send the password reset email');
    }
  });
}

/**
 * Changes the password of somebody who is already signed in.
 *
 * ── Why the current password is required ──────────────────────────────────
 * A session cookie proves the browser was signed in at some point. It does not
 * prove the person at the keyboard is the account owner — an unattended laptop
 * and a stolen session both look identical to it. Asking for the old password
 * is what turns "has a session" into "knows the secret", and it is the only
 * thing standing between a borrowed session and a permanently stolen account.
 *
 * ── Why the CURRENT session survives ──────────────────────────────────────
 * Every OTHER session is revoked, which is what evicts an attacker. This one is
 * kept. Signing somebody out of the session they just used to prove who they
 * are teaches them that securing their account costs them something, and the
 * eviction is already complete without it.
 *
 * Returns how many other sessions were ended, so the UI can say so rather than
 * leaving the user to wonder whether it worked everywhere.
 */
export async function changePassword(params: {
  userId: string;
  /** Kept alive. Every other session for this user is revoked. */
  sessionId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<{ otherSessionsEnded: number }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { id: true, email: true, firstName: true, passwordHash: true },
  });

  const correct = await verifyPassword(user.passwordHash, params.currentPassword);
  if (!correct) {
    logger.warn({ userId: user.id }, 'Password change refused: current password wrong');
    // A field error rather than a 401: the session is perfectly valid, it is
    // the typed password that is wrong. A 401 here would make the client think
    // it had been signed out and bounce the user to the login screen.
    throw validationFailed({ currentPassword: 'That is not your current password' });
  }

  const passwordHash = await hashPassword(params.newPassword);
  const now = new Date();

  const [, revoked] = await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // Someone who has just proved they know the password should not still
        // be locked out by earlier failed attempts.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: params.sessionId } },
      data: { revokedAt: now },
    }),
    // Any outstanding reset link is now a way back in for whoever requested it.
    prisma.verificationToken.updateMany({
      where: { userId: user.id, type: 'PASSWORD_RESET', consumedAt: null },
      data: { consumedAt: now },
    }),
  ]);

  logger.info(
    { userId: user.id, otherSessionsEnded: revoked.count },
    'Password changed',
  );

  // A security notice, not a receipt — the point is to reach the real owner
  // when it was not them. After the commit, and it can never throw: a mail
  // failure must not make a completed password change look like it failed.
  try {
    await emailService.sendPasswordChanged({
      to: user.email,
      firstName: user.firstName,
      otherSessionsEnded: revoked.count,
      resetUrl: `${env.WEB_ORIGIN}/forgot-password`,
    });
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Could not send the password change email');
  }

  return { otherSessionsEnded: revoked.count };
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

  const [, , revoked] = await prisma.$transaction([
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

  const sessionsEnded = revoked.count;

  // The in-app password change has always emailed; completing a reset did not,
  // which is backwards — a reset is the path an attacker with inbox access
  // takes, and it silently ends every session the real owner had. If this was
  // not them, this message is the only thing that tells them so.
  try {
    await emailService.sendPasswordChanged({
      to: record.user.email,
      firstName: record.user.firstName,
      otherSessionsEnded: sessionsEnded,
      resetUrl: `${env.WEB_ORIGIN}/forgot-password`,
    });
  } catch (err) {
    logger.error({ err, userId: record.userId }, 'Could not send the password reset confirmation');
  }
}

export async function getUserById(userId: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Account not found.');
  return user;
}

export { revokeAllSessions };

/**
 * Whether this user may still change the name on their account.
 *
 * The name is sent to the identity provider as expected_details so a mismatch
 * against the document is flagged. Once a document has been checked against a
 * name, letting that name change silently would break the link between the
 * account and the identity that was actually verified — the account would read
 * as one person while the passed check attests to another.
 *
 * So it is open exactly while no check stands behind it:
 *   NOT_STARTED / REJECTED / EXPIRED  -> editable, which is the whole point:
 *                                        a failed check is usually a name that
 *                                        does not match the document
 *   PENDING                           -> locked, a check is in flight on it
 *   VERIFIED                          -> locked, a document attests to it
 */
export function canEditName(kycStatus: KycStatus): boolean {
  return kycStatus === 'NOT_STARTED' || kycStatus === 'REJECTED' || kycStatus === 'EXPIRED';
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<PublicUser> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const changingName =
    (input.firstName !== undefined && input.firstName !== user.firstName) ||
    (input.lastName !== undefined && input.lastName !== user.lastName);

  if (changingName && !canEditName(user.kycStatus)) {
    // Rejected rather than ignored. A settings form that appears to save a new
    // name and does not is worse than one that explains why it cannot.
    throw validationFailed({
      firstName:
        user.kycStatus === 'PENDING'
          ? 'Locked while your identity check is in progress.'
          : 'Locked: your identity is verified against this name. Contact support to change it.',
    });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      // An empty string means "remove it", which is distinct from the field
      // being absent, which means "leave it alone".
      ...(input.phone !== undefined ? { phone: input.phone === '' ? null : input.phone } : {}),
    },
  });

  logger.info({ userId, changedName: changingName }, 'Profile updated');
  return toPublicUser(updated);
}
