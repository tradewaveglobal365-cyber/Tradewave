import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { formatUsd } from '../../lib/money';
import { emailService } from '../email';
import { computeAccrual } from '../../modules/investment/accrual';
import { settleMaturedInvestments } from '../../modules/investment/maturity.service';
import { reconcileDeposits } from '../../modules/wallet/deposit.service';
import { reconcileWithdrawals } from '../../modules/wallet/withdrawal.service';

/**
 * What runs on a timer, and how often.
 *
 * ── Why every job here stamps a marker ────────────────────────────────────
 * The lock in lock.ts protects against two INSTANCES running a job at the same
 * moment. It does nothing about the same instance running the job again an hour
 * later and finding the same rows still matching. So each job narrows its query
 * by a nullable timestamp it then fills in — Investment.maturityNoticeSentAt,
 * User.lastStatementPeriod, KycVerification.abandonedNoticeSentAt — and the
 * stamp is written with a conditional updateMany so the write is the gate, not
 * a check that happened moments earlier.
 *
 * Between them: the lock makes a job single-writer, the marker makes it
 * at-most-once. Neither alone is enough to keep an investor from being emailed
 * the same statement twice.
 */

export interface Job {
  name: string;
  /** Minimum gap between runs. Enforced inside the claim query. */
  everyMs: number;
  /** How long the lock is held before it is considered abandoned. */
  leaseMs: number;
  run: () => Promise<void>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How many rows one pass will touch. A job is a heartbeat, not a bulk mailer. */
const BATCH = 200;

/** Matches the certificates and statements, so a PDF and an email agree. */
const longDate = (d: Date): string =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The period key a statement is filed under, e.g. "2026-08". */
const periodKey = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

const periodLabel = (d: Date): string =>
  d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// ── Maturity notices ────────────────────────────────────────────────────────

const NOTICE_DAYS = 7;

/**
 * Tells investors a week before their money comes back.
 *
 * Deliberately a NOTICE and not a settlement: it changes nothing, so a failure
 * here costs an email and never a payout. The settlement sweep below is what
 * actually moves money, and it is idempotent independently of this.
 */
async function maturityNotices(): Promise<void> {
  const now = new Date();
  const horizon = new Date(now.getTime() + NOTICE_DAYS * 24 * HOUR);

  const due = await prisma.investment.findMany({
    where: {
      status: 'ACTIVE',
      maturesAt: { gt: now, lte: horizon },
      maturityNoticeSentAt: null,
    },
    take: BATCH,
    select: {
      id: true,
      principalCents: true,
      annualReturnBps: true,
      investedAt: true,
      maturesAt: true,
      user: { select: { email: true, firstName: true, status: true } },
      property: { select: { title: true } },
    },
  });

  for (const inv of due) {
    // Claim this specific notice before sending. Two ticks racing on one row
    // is not possible under the lock, but a retry after a partial batch is —
    // and the stamp is what makes the resend impossible rather than unlikely.
    const { count } = await prisma.investment.updateMany({
      where: { id: inv.id, maturityNoticeSentAt: null },
      data: { maturityNoticeSentAt: new Date() },
    });
    if (count === 0) continue;

    // Suspended accounts are skipped, matching every other send in the product.
    if (inv.user.status === 'SUSPENDED') continue;

    const { projectedTotalCents } = computeAccrual(
      {
        principalCents: inv.principalCents,
        annualReturnBps: inv.annualReturnBps,
        investedAt: inv.investedAt,
        maturesAt: inv.maturesAt,
      },
      now,
    );

    try {
      await emailService.sendMaturityApproaching({
        to: inv.user.email,
        firstName: inv.user.firstName,
        propertyTitle: inv.property.title,
        payout: formatUsd(projectedTotalCents),
        maturesOn: longDate(inv.maturesAt),
        days: Math.max(1, Math.round((inv.maturesAt.getTime() - now.getTime()) / (24 * HOUR))),
        url: `${env.WEB_ORIGIN}/portfolio`,
      });
    } catch (err) {
      // The stamp stays. A retried notice a week late is worse than none, and
      // the alternative — clearing it — risks a loop that emails on every tick.
      logger.error({ err, investmentId: inv.id }, 'Could not send the maturity notice');
    }
  }

  if (due.length > 0) logger.info({ count: due.length }, 'Maturity notices processed');
}

// ── Monthly statements ──────────────────────────────────────────────────────

/**
 * Emails last month's summary, once per investor per month.
 *
 * The figures are read off the ledger rather than recomputed, the same way
 * document.service builds the PDF: the entry immediately before the period
 * already records the balance at that moment, so an opening figure cannot
 * drift from the wallet.
 *
 * Links, never attaches — the investor downloads the PDF from /documents,
 * which is a decision the plan took for every document in the product.
 */
async function monthlyStatements(): Promise<void> {
  const now = new Date();

  // The month that has just ended.
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1);
  const key = periodKey(from);

  const users = await prisma.user.findMany({
    where: {
      // Somebody who never confirmed their address should not be sent a
      // financial summary of it.
      emailVerifiedAt: { not: null },
      status: { not: 'SUSPENDED' },
      OR: [{ lastStatementPeriod: null }, { lastStatementPeriod: { not: key } }],
      // No wallet means nothing ever moved, and a statement of nothing is spam.
      wallet: { is: {} },
    },
    take: BATCH,
    select: { id: true, email: true, firstName: true, wallet: { select: { id: true } } },
  });

  for (const user of users) {
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ lastStatementPeriod: null }, { lastStatementPeriod: { not: key } }] },
      data: { lastStatementPeriod: key },
    });
    if (count === 0) continue;

    const walletId = user.wallet?.id;
    if (!walletId) continue;

    const [entries, previous] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where: { walletId, createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'asc' },
        select: { type: true, amountCents: true, balanceAfterCents: true },
      }),
      prisma.ledgerEntry.findFirst({
        where: { walletId, createdAt: { lt: from } },
        orderBy: { createdAt: 'desc' },
        select: { balanceAfterCents: true },
      }),
    ]);

    // A month in which nothing happened gets no email. The investor learns
    // nothing from it, and it is the difference between a statement and noise.
    if (entries.length === 0) continue;

    const opening = previous?.balanceAfterCents ?? 0n;
    const closing = entries.at(-1)?.balanceAfterCents ?? opening;

    const sum = (t: string): bigint =>
      entries.filter((e) => e.type === t).reduce((a, e) => a + (e.amountCents < 0n ? -e.amountCents : e.amountCents), 0n);

    try {
      await emailService.sendMonthlyStatement({
        to: user.email,
        firstName: user.firstName,
        period: periodLabel(from),
        openingBalance: formatUsd(opening),
        closingBalance: formatUsd(closing),
        invested: formatUsd(sum('INVESTMENT')),
        earned: formatUsd(sum('RETURN_PAYOUT') + sum('REFERRAL_BONUS')),
        url: `${env.WEB_ORIGIN}/documents`,
      });
    } catch (err) {
      logger.error({ err, userId: user.id }, 'Could not send the monthly statement');
    }
  }

  if (users.length > 0) logger.info({ count: users.length, period: key }, 'Statements processed');
}

// ── Abandoned identity checks ───────────────────────────────────────────────

/** Long enough that somebody who stepped away to find their passport is not nagged. */
const ABANDONED_AFTER_MS = 24 * HOUR;

/**
 * Nudges people who started verifying and stopped.
 *
 * Only while the provider's own session is still valid, because the email's
 * entire value is the resume link — sending "carry on where you left off" with
 * a dead link is worse than silence, and starting a fresh session costs money.
 *
 * Treated as transactional, not marketing: it is about finishing something they
 * started, not about selling them anything.
 */
async function abandonedIdentityChecks(): Promise<void> {
  const now = new Date();

  const stale = await prisma.kycVerification.findMany({
    where: {
      status: 'PENDING',
      abandonedNoticeSentAt: null,
      submittedAt: { lt: new Date(now.getTime() - ABANDONED_AFTER_MS) },
      redirectUrl: { not: null },
      AND: [
        // Still resumable. A session with no expiry is treated as still open.
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        // "In Review" means a human has it; that is our queue, not their to-do.
        //
        // Spelled with an explicit null arm rather than `NOT: { providerStatus:
        // 'In Review' }`, which excludes every row where the column is NULL —
        // SQL's `NOT (col = x)` is NULL, not true, for a NULL column. That is
        // most of them, and it made this job silently do nothing.
        { OR: [{ providerStatus: null }, { providerStatus: { not: 'In Review' } }] },
      ],
    },
    take: BATCH,
    select: {
      id: true,
      redirectUrl: true,
      user: { select: { email: true, firstName: true, status: true } },
    },
  });

  for (const row of stale) {
    const { count } = await prisma.kycVerification.updateMany({
      where: { id: row.id, abandonedNoticeSentAt: null },
      data: { abandonedNoticeSentAt: new Date() },
    });
    if (count === 0) continue;
    if (row.user.status === 'SUSPENDED') continue;

    try {
      await emailService.sendKycAbandoned({
        to: row.user.email,
        firstName: row.user.firstName,
        url: row.redirectUrl ?? `${env.WEB_ORIGIN}/verify-identity`,
      });
    } catch (err) {
      logger.error({ err, verificationId: row.id }, 'Could not send the abandoned identity email');
    }
  }

  if (stale.length > 0) logger.info({ count: stale.length }, 'Abandoned identity nudges processed');
}

// ── The existing sweeps, on a real heartbeat ────────────────────────────────

/**
 * The gain that has nothing to do with email.
 *
 * Maturity settlement, deposit reconciliation and withdrawal reconciliation all
 * run opportunistically off page loads today, which is fine while somebody is
 * looking and does nothing at all on a quiet weekend. Money sits unsettled
 * until a human happens to open a screen.
 *
 * Each of these was already written to be idempotent and to swallow its own
 * failures, because a page load could never be allowed to fail on them. That is
 * exactly what makes them safe to call on a timer.
 */
async function sweeps(): Promise<void> {
  await settleMaturedInvestments();
  await reconcileDeposits();
  await reconcileWithdrawals();
}

export const JOBS: Job[] = [
  { name: 'sweeps', everyMs: 5 * MINUTE, leaseMs: 10 * MINUTE, run: sweeps },
  { name: 'maturity-notices', everyMs: 6 * HOUR, leaseMs: 15 * MINUTE, run: maturityNotices },
  { name: 'abandoned-identity', everyMs: 6 * HOUR, leaseMs: 15 * MINUTE, run: abandonedIdentityChecks },
  { name: 'monthly-statements', everyMs: 6 * HOUR, leaseMs: 30 * MINUTE, run: monthlyStatements },
];
