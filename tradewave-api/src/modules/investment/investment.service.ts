import { prisma } from '../../lib/prisma';
import { computeAccrual, addMonths } from './accrual';
import { formatUsd } from '../../lib/money';
import { generateToken } from '../../lib/crypto';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { emailService } from '../../services/email';
import { creditReferralBonus, notifyReferralBonus } from '../referral/referral.service';
import { debitSpendable } from '../wallet/wallet.service';
import {
  belowMinimumInvestment,
  notFound,
  propertyUnavailable,
} from '../../lib/errors';

export interface HoldingView {
  id: string;
  property: {
    slug: string;
    title: string;
    area: string;
    city: string;
    image: string | null;
  };
  principalCents: bigint;
  accruedCents: bigint;
  currentValueCents: bigint;
  projectedTotalCents: bigint;
  annualReturnBps: number;
  termMonths: number;
  investedAt: Date;
  maturesAt: Date;
  progress: number;
  isMatured: boolean;
  status: string;
}

export interface PortfolioView {
  holdingCount: number;
  totalInvestedCents: bigint;
  currentValueCents: bigint;
  accruedCents: bigint;
  holdings: HoldingView[];
}

/**
 * The portfolio, with every accrued figure DERIVED on read.
 *
 * Nothing here is stored, so there is no nightly job to miss and no running
 * total that can drift out of step with its inputs.
 */
export async function getPortfolio(userId: string, now = new Date()): Promise<PortfolioView> {
  const investments = await prisma.investment.findMany({
    where: { userId, status: { in: ['ACTIVE', 'MATURED'] } },
    include: {
      property: { select: { slug: true, title: true, area: true, city: true, images: true } },
    },
    orderBy: { investedAt: 'desc' },
  });

  const holdings: HoldingView[] = investments.map((inv) => {
    const accrual = computeAccrual(
      {
        principalCents: inv.principalCents,
        annualReturnBps: inv.annualReturnBps,
        investedAt: inv.investedAt,
        maturesAt: inv.maturesAt,
      },
      now,
    );

    return {
      id: inv.id,
      property: {
        slug: inv.property.slug,
        title: inv.property.title,
        area: inv.property.area,
        city: inv.property.city,
        image: inv.property.images[0] ?? null,
      },
      principalCents: accrual.principalCents,
      accruedCents: accrual.accruedCents,
      currentValueCents: accrual.currentValueCents,
      projectedTotalCents: accrual.projectedTotalCents,
      annualReturnBps: inv.annualReturnBps,
      termMonths: inv.termMonths,
      investedAt: inv.investedAt,
      maturesAt: inv.maturesAt,
      progress: accrual.progress,
      isMatured: accrual.isMatured,
      status: inv.status,
    };
  });

  // Sum with BigInt, never by mapping to Number first — that is exactly the
  // drift this codebase exists to avoid.
  const totalInvestedCents = holdings.reduce((sum, h) => sum + h.principalCents, 0n);
  const accruedCents = holdings.reduce((sum, h) => sum + h.accruedCents, 0n);

  return {
    holdingCount: holdings.length,
    totalInvestedCents,
    accruedCents,
    currentValueCents: totalInvestedCents + accruedCents,
    holdings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Buys a fractional stake in a property.
 *
 * Everything below happens in ONE transaction. Partial application here means a
 * debited wallet with no investment to show for it, which is the worst possible
 * failure mode in this system.
 *
 * The two writes that matter are both CONDITIONAL updates rather than
 * read-then-write. Reading a balance, checking it in JS, and then writing is a
 * race: two concurrent requests both read the same balance, both pass the
 * check, and both debit. Putting the condition in the WHERE clause makes the
 * database arbitrate, and the loser simply matches zero rows.
 */
export async function createInvestment(
  userId: string,
  propertyId: string,
  amountCents: bigint,
) {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property || property.status === 'DRAFT') throw notFound('Property not found.');

  // Cheap pre-checks for good error messages. They are NOT the safety net —
  // the conditional updates below are, because state can change between here
  // and the transaction.
  if (property.status !== 'OPEN') throw propertyUnavailable();
  if (amountCents < property.minInvestmentCents) {
    throw belowMinimumInvestment(formatUsd(property.minInvestmentCents));
  }
  if (amountCents > property.totalValueCents - property.fundedCents) {
    throw propertyUnavailable('That is more than the property has remaining.');
  }

  const wallet = await prisma.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  const result = await prisma.$transaction(async (tx) => {
    // ── 1. Debit the wallet, atomically ──────────────────────────────────
    // The balance filter sits in WHERE, so a concurrent request that already
    // spent the money finds no matching row. Locked referral earnings are not
    // reachable here either — see debitSpendable.
    const balanceAfterCents = await debitSpendable(tx, {
      walletId: wallet.id,
      amountCents,
      verb: 'invested',
      shortfallMessage: 'Your wallet balance is not enough for this investment.',
    });

    // ── 2. Take the allocation, atomically ───────────────────────────────
    // Raw SQL because the comparison needs arithmetic on two columns, which
    // Prisma's field references cannot express.
    const claimed = await tx.$executeRaw`
      UPDATE "Property"
      SET "fundedCents" = "fundedCents" + ${amountCents}
      WHERE id = ${propertyId}::uuid
        AND status = 'OPEN'
        AND "fundedCents" + ${amountCents} <= "totalValueCents"
    `;
    if (claimed === 0) {
      // Someone took the remaining allocation first. Throwing rolls back the
      // debit above — the user is not charged for a stake they did not get.
      throw propertyUnavailable('That allocation was just taken. Try a smaller amount.');
    }

    const investedAt = new Date();
    const investment = await tx.investment.create({
      data: {
        userId,
        propertyId,
        principalCents: amountCents,
        // Snapshot the terms. Editing the property later must never change
        // what an existing investor already agreed to.
        annualReturnBps: property.annualReturnBps,
        termMonths: property.termMonths,
        investedAt,
        maturesAt: addMonths(investedAt, property.termMonths),
      },
    });

    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: 'INVESTMENT',
        amountCents: -amountCents, // debits are negative
        balanceAfterCents,
        reference: `inv_${investment.id}_${generateToken().slice(0, 12)}`,
        description: `Investment in ${property.title}`,
        investmentId: investment.id,
      },
    });

    // Pay whoever invited them, if this is their first investment. Inside this
    // transaction on purpose: a bonus credited against an investment that then
    // rolled back would be money invented from nothing.
    const referralBonus = await creditReferralBonus(tx, {
      investorId: userId,
      investmentId: investment.id,
      principalCents: amountCents,
    });

    // Close the property once it is fully subscribed.
    const fresh = await tx.property.findUniqueOrThrow({ where: { id: propertyId } });
    if (fresh.fundedCents >= fresh.totalValueCents && fresh.status === 'OPEN') {
      await tx.property.update({ where: { id: propertyId }, data: { status: 'FUNDED' } });
    }

    return { investment, balanceAfterCents, referralBonus };
  });

  // Whoever invited them earned something. After the commit, for the same
  // reason as the confirmation below — and it swallows its own failures, so a
  // bounced email cannot undo a bonus that is already in somebody's wallet.
  if (result.referralBonus) {
    await notifyReferralBonus({
      referrerId: result.referralBonus.referrerId,
      investorId: userId,
      bonusCents: result.referralBonus.bonusCents,
      locked: result.referralBonus.locked,
    });
  }

  // After the commit, never inside it: an email provider being slow must not
  // hold a transaction that has a wallet and a property allocation locked, and
  // a failure here must not roll back an investment the user has paid for.
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true },
    });
    if (user) {
      await emailService.sendInvestmentConfirmed({
        to: user.email,
        firstName: user.firstName,
        propertyTitle: property.title,
        amount: formatUsd(amountCents),
        annualReturn: `${(property.annualReturnBps / 100).toFixed(2)}%`,
        termMonths: property.termMonths,
        maturesOn: result.investment.maturesAt.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
        url: `${env.WEB_ORIGIN}/portfolio`,
      });
    }
  } catch (err) {
    logger.error({ err, userId }, 'Could not send the investment confirmation email');
  }

  return result;
}
