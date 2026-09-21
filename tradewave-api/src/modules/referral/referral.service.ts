import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { formatUsd } from '../../lib/money';
import { emailService } from '../../services/email';

/**
 * What a referrer earns, in basis points of what the person they invited
 * invests. 100 bps = 1%.
 *
 * Paid on the invitee's FIRST investment only. Every investment forever would
 * be more motivating and is an unbounded commitment: one referrer who brings in
 * a large repeat investor earns from them indefinitely, with no clean way to
 * end it. One payment per person invited stays budgetable.
 *
 * Basis points rather than a float, for the same reason every other rate in
 * this codebase is: a percentage of somebody's money computed in floating point
 * is a rounding error waiting to become a support ticket.
 */
export const REFERRAL_BONUS_BPS = 100;

const BPS_DENOMINATOR = 10_000n;

/** Truncates, so a rounding error can never favour us over the referrer. */
export function referralBonusCents(principalCents: bigint): bigint {
  return (principalCents * BigInt(REFERRAL_BONUS_BPS)) / BPS_DENOMINATOR;
}

export interface ReferralSummary {
  code: string;
  shareUrl: string;
  totalReferrals: number;
  verifiedReferrals: number;
  /** How many invitees have invested, and so earned this referrer something. */
  investedReferrals: number;
  /** Total earned, in cents. Summed from the ledger, never stored separately. */
  earnedCents: string;
  /**
   * How much of it cannot be spent yet, in cents. "0" once verified.
   *
   * Read off the wallet rather than recomputed from the ledger: the wallet is
   * where the encumbrance actually lives, and a second derivation of the same
   * figure is a second thing that can disagree with it.
   */
  lockedCents: string;
  bonusBps: number;
}

export interface ReferralListItem {
  displayName: string;
  maskedEmail: string;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'RESTRICTED' | 'SUSPENDED';
  joinedAt: Date;
}

export async function getSummary(userId: string): Promise<ReferralSummary> {
  const [user, totalReferrals, verifiedReferrals, investedReferrals, earned] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          referralCode: true,
          kycStatus: true,
          wallet: { select: { lockedCents: true } },
        },
      }),
      prisma.user.count({ where: { referredById: userId } }),
      prisma.user.count({ where: { referredById: userId, emailVerifiedAt: { not: null } } }),
      prisma.user.count({
        where: { referredById: userId, investments: { some: {} } },
      }),
      // Summed from the ledger rather than kept as a running total on the user.
      // A stored total is a number that can drift away from the entries that
      // justify it, and then nobody can say which one is wrong.
      prisma.ledgerEntry.aggregate({
        where: { type: 'REFERRAL_BONUS', wallet: { userId } },
        _sum: { amountCents: true },
      }),
    ]);

  return {
    code: user.referralCode,
    shareUrl: `${env.WEB_ORIGIN}/signup?ref=${user.referralCode}`,
    totalReferrals,
    verifiedReferrals,
    investedReferrals,
    earnedCents: (earned._sum.amountCents ?? 0n).toString(),
    // The lock is advisory and binds only while unverified, so a wallet whose
    // column has not been zeroed yet must still report nothing held.
    lockedCents: (user.kycStatus === 'VERIFIED'
      ? 0n
      : (user.wallet?.lockedCents ?? 0n)
    ).toString(),
    bonusBps: REFERRAL_BONUS_BPS,
  };
}

/**
 * Pays the referrer, if there is one and this is the first time.
 *
 * Takes a transaction client because it MUST run inside the one that creates
 * the investment: a bonus credited against an investment that then rolled back
 * is money invented from nothing, and an investment that succeeded without
 * paying a promised bonus is a support ticket nobody can reconstruct.
 *
 * Returns who was paid and how much, or null when nothing was owed. The caller
 * needs both to send the notification AFTER the transaction commits — telling
 * somebody they earned money inside a transaction that then rolls back is worse
 * than not telling them at all.
 */
export interface ReferralBonusPaid {
  referrerId: string;
  bonusCents: bigint;
  /** Whether it landed encumbered, which changes what the email may promise. */
  locked: boolean;
}

export async function creditReferralBonus(
  tx: Prisma.TransactionClient,
  params: { investorId: string; investmentId: string; principalCents: bigint },
): Promise<ReferralBonusPaid | null> {
  const investor = await tx.user.findUnique({
    where: { id: params.investorId },
    select: { referredById: true },
  });
  if (!investor?.referredById) return null;

  // First investment only. Counted inside the transaction, AFTER the new row
  // exists — so exactly one is the first, and a concurrent second investment
  // sees two and pays nothing.
  const investmentCount = await tx.investment.count({
    where: { userId: params.investorId },
  });
  if (investmentCount !== 1) return null;

  const referrer = await tx.user.findUnique({
    where: { id: investor.referredById },
    select: { id: true, status: true, kycStatus: true },
  });
  // A suspended referrer is skipped for the same reason a suspended one cannot
  // attribute a signup: we are not paying an account we have shut off.
  if (!referrer || referrer.status === 'SUSPENDED') return null;

  const bonusCents = referralBonusCents(params.principalCents);
  if (bonusCents <= 0n) return null;

  /**
   * Paid, but not spendable until we know who we paid.
   *
   * Identity verification no longer gates anything else — an investor can
   * deposit, invest and withdraw their OWN money unverified, which is the whole
   * point of opening the door. A referral bonus is different in kind: it is our
   * money moving to someone on the strength of a third party's deposit, and
   * paying it out to an unidentified account is the one thing an open door
   * would otherwise turn into a business.
   *
   * So it lands in the balance and stays there, visible and locked, until a
   * check passes. Locking on credit rather than checking on spend means the
   * referrals page can show exactly what is waiting, which is a better argument
   * for verifying than any banner.
   */
  const locked = referrer.kycStatus !== 'VERIFIED';

  const wallet = await tx.wallet.upsert({
    where: { userId: referrer.id },
    update: {
      balanceCents: { increment: bonusCents },
      ...(locked ? { lockedCents: { increment: bonusCents } } : {}),
    },
    create: {
      userId: referrer.id,
      balanceCents: bonusCents,
      lockedCents: locked ? bonusCents : 0n,
    },
  });

  // Unique, so a replay cannot pay the same bonus twice — the constraint does
  // the work rather than a check somebody has to remember to write.
  await tx.ledgerEntry.create({
    data: {
      walletId: wallet.id,
      type: 'REFERRAL_BONUS',
      amountCents: bonusCents,
      balanceAfterCents: wallet.balanceCents,
      reference: `ref_${params.investmentId}`,
      description: 'Referral bonus',
      investmentId: params.investmentId,
    },
  });

  logger.info(
    {
      referrerId: referrer.id,
      investorId: params.investorId,
      bonusCents: bonusCents.toString(),
      locked,
    },
    'Referral bonus credited',
  );

  return { referrerId: referrer.id, bonusCents, locked };
}

/**
 * Invitees are other people. The referrer gets enough to recognise who joined
 * and nothing more — no full email, no phone. Masking here rather than in the
 * UI means the full address never leaves the server.
 */
export async function listReferrals(userId: string, page: number, perPage: number) {
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where: { referredById: userId },
      select: { firstName: true, lastName: true, email: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.user.count({ where: { referredById: userId } }),
  ]);

  const items: ReferralListItem[] = rows.map((r) => ({
    displayName: `${r.firstName} ${r.lastName.charAt(0)}.`,
    maskedEmail: maskEmail(r.email),
    status: r.status,
    joinedAt: r.createdAt,
  }));

  return { items, total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(3, local.length - head.length))}@${domain}`;
}

/**
 * Public lookup used by the signup form to render "Invited by Ada".
 * Returns only a first name — never confirms an email or exposes a user id.
 */
export async function validateCode(code: string) {
  const referrer = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { firstName: true, status: true },
  });

  if (!referrer || referrer.status === 'SUSPENDED') return { valid: false as const };
  return { valid: true as const, referrerFirstName: referrer.firstName };
}

/** The rate as a percentage, for anything a human reads. */
export function formatBonusRate(): string {
  const percent = REFERRAL_BONUS_BPS / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

/**
 * Tells the referrer they were paid.
 *
 * Called AFTER the investment transaction commits, and swallows its own
 * failures — a mail provider being slow must never be what rolls back an
 * investment somebody has already paid for.
 */
export async function notifyReferralBonus(params: {
  referrerId: string;
  investorId: string;
  bonusCents: bigint;
  locked: boolean;
}): Promise<void> {
  try {
    const [referrer, investor] = await Promise.all([
      prisma.user.findUnique({
        where: { id: params.referrerId },
        select: { email: true, firstName: true },
      }),
      prisma.user.findUnique({
        where: { id: params.investorId },
        select: { firstName: true, lastName: true },
      }),
    ]);
    if (!referrer || !investor) return;

    await emailService.sendReferralBonus({
      to: referrer.email,
      firstName: referrer.firstName,
      // Masked the same way /referrals masks it. Referring somebody is not a
      // reason to be handed their full name.
      inviteeName: `${investor.firstName} ${investor.lastName.charAt(0)}.`,
      amount: formatUsd(params.bonusCents),
      rate: formatBonusRate(),
      locked: params.locked,
      url: `${env.WEB_ORIGIN}/referrals`,
    });
  } catch (err) {
    logger.error({ err, referrerId: params.referrerId }, 'Could not send the referral bonus email');
  }
}
