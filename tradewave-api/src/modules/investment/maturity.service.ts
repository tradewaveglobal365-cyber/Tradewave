import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { isTest } from '../../config/env';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { formatUsd } from '../../lib/money';
import { emailService } from '../../services/email';
import { computeAccrual } from './accrual';

/**
 * Paying investors back when their term ends.
 *
 * ── Why this is the only part of accrual that writes anything ─────────────
 * What a holding is WORTH is derived on read and never stored — see accrual.ts.
 * That is what makes a missed run harmless: the number is the same whether it
 * was asked for today or in a year. But money becoming SPENDABLE is a real
 * event, and that has to be recorded once and exactly once.
 *
 * So settlement is the single write in this area, and it is guarded twice: the
 * status transition is conditional on the row still being ACTIVE, and the
 * ledger references are derived from the investment id and unique. Two callers
 * racing — an investor opening their portfolio while an admin opens the queue —
 * cannot both credit the same maturity.
 *
 * ── Why the figure is computed AT maturesAt, not at now ───────────────────
 * Accrual stops at maturity anyway, so the two agree. Passing maturesAt
 * explicitly makes that a property of the code rather than a coincidence: an
 * investment settled three weeks late pays exactly what it would have paid on
 * the day, and nobody earns interest on our slowness.
 */

/** How often the sweep may run, and how many it settles per pass. */
const SWEEP_INTERVAL_MS = 30_000;
const SWEEP_PAGE_SIZE = 50;
let lastSweepAt = 0;

export interface SettledMaturity {
  investmentId: string;
  userId: string;
  propertyTitle: string;
  principalCents: bigint;
  returnCents: bigint;
  totalCents: bigint;
}

/**
 * Settles one matured investment, or returns null if somebody already has.
 *
 * Exported so an admin can force a single one without waiting for the sweep.
 */
async function settleOnly(investmentId: string): Promise<SettledMaturity | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Claim it. The status filter is the lock: a concurrent caller matches
      // zero rows and gets null rather than crediting the same money twice.
      const claimed = await tx.investment.updateMany({
        where: { id: investmentId, status: 'ACTIVE', maturesAt: { lte: new Date() } },
        data: { status: 'MATURED' },
      });
      if (claimed.count === 0) return null;

      const investment = await tx.investment.findUniqueOrThrow({
        where: { id: investmentId },
        include: { property: { select: { id: true, title: true, status: true } } },
      });

      // At maturesAt, not at now — see the note at the top of this file.
      const accrual = computeAccrual(
        {
          principalCents: investment.principalCents,
          annualReturnBps: investment.annualReturnBps,
          investedAt: investment.investedAt,
          maturesAt: investment.maturesAt,
        },
        investment.maturesAt,
      );

      const returnCents = accrual.accruedCents;
      const totalCents = investment.principalCents + returnCents;

      const wallet = await tx.wallet.upsert({
        where: { userId: investment.userId },
        update: { balanceCents: { increment: totalCents } },
        create: { userId: investment.userId, balanceCents: totalCents },
      });

      // Two entries rather than one. The capital coming back and the money
      // earned on it are different things — to an investor reading their
      // transactions, and to anyone who ever has to account for them.
      const runningAfterPrincipal = wallet.balanceCents - returnCents;

      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          type: 'RETURN_PAYOUT',
          amountCents: investment.principalCents,
          balanceAfterCents: runningAfterPrincipal,
          reference: `mat_${investmentId}_principal`,
          description: `Principal returned — ${investment.property.title}`,
          investmentId,
        },
      });

      if (returnCents > 0n) {
        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            type: 'RETURN_PAYOUT',
            amountCents: returnCents,
            balanceAfterCents: wallet.balanceCents,
            reference: `mat_${investmentId}_return`,
            description: `Return earned — ${investment.property.title}`,
            investmentId,
          },
        });
      }

      // A property whose last holding has matured is finished. Checked inside
      // the transaction so it cannot be decided from a stale count.
      const stillRunning = await tx.investment.count({
        where: { propertyId: investment.property.id, status: 'ACTIVE' },
      });
      if (stillRunning === 0 && investment.property.status === 'FUNDED') {
        await tx.property.update({
          where: { id: investment.property.id },
          data: { status: 'CLOSED' },
        });
      }

      return {
        investmentId,
        userId: investment.userId,
        propertyTitle: investment.property.title,
        principalCents: investment.principalCents,
        returnCents,
        totalCents,
      };
    });
  } catch (err) {
    // The unique reference is the second guard. If two transactions somehow get
    // past the status claim, the loser dies here and rolls back its credit.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.info({ investmentId }, 'Investment was already settled');
      return null;
    }
    throw err;
  }
}

/**
 * Settles one matured investment and tells the investor.
 *
 * The notification lives HERE rather than in the callers because it did not,
 * and the admin "settle now" button proved why: it called the settle step
 * directly and skipped the email, so an investor whose maturity was forced
 * through by hand was paid and never told, while the sweep's identical
 * settlement emailed. One path, so a third caller cannot reintroduce the gap.
 */
export async function settleInvestment(investmentId: string): Promise<SettledMaturity | null> {
  const settled = await settleOnly(investmentId);
  if (settled) await notifyMatured(settled);
  return settled;
}

/**
 * Settles everything that has come due.
 *
 * Opportunistic: runs off a portfolio read and off the admin queue, throttled,
 * and swallows its own failures. There is no cron, and the thing that makes
 * that acceptable is that a LATE settlement pays exactly what an on-time one
 * would — so the only cost of a quiet week is that the money is not spendable
 * yet, and the sweep fires the moment the investor looks.
 */
export async function settleMaturedInvestments(now = Date.now()): Promise<number> {
  // The throttle is a production concern — it stops a busy site re-running this
  // on every page load. Under test it would instead mean the first case to
  // trigger a sweep silently disables it for every case after, which is a
  // suite that passes by not running the thing it is testing. Same reasoning as
  // the rate limiters, which skip under test for the same reason.
  if (!isTest && now - lastSweepAt < SWEEP_INTERVAL_MS) return 0;
  lastSweepAt = now;

  try {
    const due = await prisma.investment.findMany({
      where: { status: 'ACTIVE', maturesAt: { lte: new Date(now) } },
      orderBy: { maturesAt: 'asc' },
      take: SWEEP_PAGE_SIZE,
      select: { id: true },
    });

    let settled = 0;
    for (const row of due) {
      const result = await settleInvestment(row.id);
      if (!result) continue;
      settled += 1;
    }

    if (settled > 0) logger.info({ settled }, 'Matured investments settled');
    return settled;
  } catch (err) {
    logger.warn({ err }, 'Maturity sweep failed');
    return 0;
  }
}

/** Tells the investor their money is back. Never lets a mail failure matter. */
async function notifyMatured(settled: SettledMaturity): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: settled.userId },
      select: { email: true, firstName: true },
    });
    if (!user) return;

    await emailService.sendInvestmentMatured({
      to: user.email,
      firstName: user.firstName,
      propertyTitle: settled.propertyTitle,
      principal: formatUsd(settled.principalCents),
      earned: formatUsd(settled.returnCents),
      total: formatUsd(settled.totalCents),
      url: `${env.WEB_ORIGIN}/wallet`,
    });
  } catch (err) {
    logger.error({ err, investmentId: settled.investmentId }, 'Could not send the maturity email');
  }
}

// ── What is coming ───────────────────────────────────────────────────────────

export interface UpcomingMaturity {
  investmentId: string;
  maturesAt: Date;
  /** Negative once it is overdue, which is the case staff need to see. */
  daysUntil: number;
  principalCents: string;
  payoutCents: string;
  status: string;
  propertyTitle: string;
  user: { id: string; email: string; firstName: string; lastName: string };
}

/** How far ahead the admin screen looks. */
const HORIZON_DAYS = 30;

/**
 * Maturities due soon, or overdue.
 *
 * Exists so a quiet week is visible. The sweep only runs when somebody loads a
 * page, and without a window onto what is waiting, "nobody has logged in for
 * four days" and "settlement is broken" look identical from the outside.
 */
export async function listUpcomingMaturities(): Promise<UpcomingMaturity[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);

  const rows = await prisma.investment.findMany({
    where: { status: 'ACTIVE', maturesAt: { lte: horizon } },
    orderBy: { maturesAt: 'asc' },
    include: {
      property: { select: { title: true } },
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });

  return rows.map((i) => {
    const accrual = computeAccrual(
      {
        principalCents: i.principalCents,
        annualReturnBps: i.annualReturnBps,
        investedAt: i.investedAt,
        maturesAt: i.maturesAt,
      },
      i.maturesAt,
    );
    return {
      investmentId: i.id,
      maturesAt: i.maturesAt,
      daysUntil: Math.floor((i.maturesAt.getTime() - now.getTime()) / 86_400_000),
      principalCents: i.principalCents.toString(),
      payoutCents: (i.principalCents + accrual.accruedCents).toString(),
      status: i.status,
      propertyTitle: i.property.title,
      user: i.user,
    };
  });
}
