import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { depositsUnavailable } from '../../lib/errors';
import { koboFromUsdCents, usdCentsFromKobo } from '../../lib/money';
import { paymentProvider } from '../../services/payments';
import type { ConfirmedPayment } from '../../services/payments/types';
import { getCurrentRate } from '../fx/fx.service';

/**
 * Naira deposits into a dedicated account.
 *
 * ── Why nothing here trusts a webhook ─────────────────────────────────────
 * Klasha's callbacks are unsigned — no secret, no signature header, nothing in
 * their documentation to verify against. The endpoint is a public URL anyone
 * can POST to, so a webhook is treated as a prompt to go and look, never as a
 * statement of fact. Every figure that reaches the ledger comes back from an
 * authenticated read against the provider.
 *
 * That also makes the webhook optional rather than load-bearing, which matters
 * because an unsigned callback is exactly the kind that gets lost: the sweep in
 * reconcileDeposits() finds anything the webhook missed.
 */

/** How long between merchant-wide sweeps. In memory: a missed sweep costs nothing. */
const SWEEP_INTERVAL_MS = 30_000;
const SWEEP_PAGE_SIZE = 50;
let lastSweepAt = 0;

export interface DepositAccountView {
  accountNumber: string;
  accountName: string;
  bankName: string;
  currency: string;
  /** Kobo per dollar, so the UI can quote a transfer before the user sends it. */
  rateMinorPerUnit: string | null;
  /** What ₦ the user would send to fund $100, as a worked example. */
  exampleKoboForHundredUsd: string | null;
}

/**
 * The user's permanent naira account, created on first request.
 *
 * Lazily, the way getWallet() upserts a wallet: a user who never funds anything
 * should not have an account provisioned at a provider on their behalf.
 */
export async function getDepositAccount(userId: string): Promise<DepositAccountView> {
  const existing = await prisma.depositAccount.findUnique({ where: { userId } });
  const account = existing ?? (await createDepositAccount(userId));
  const rate = await getCurrentRate();

  return {
    accountNumber: account.accountNumber,
    accountName: account.accountName,
    bankName: account.bankName,
    currency: account.currency,
    rateMinorPerUnit: rate ? rate.minorPerUnit.toString() : null,
    exampleKoboForHundredUsd: rate
      ? koboFromUsdCents(10_000n, rate.minorPerUnit).toString()
      : null,
  };
}

async function createDepositAccount(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });

  let details;
  try {
    details = await paymentProvider.createDepositAccount({ userId, ...user });
  } catch (err) {
    logger.error({ err, userId }, 'Failed to create deposit account');
    throw depositsUnavailable(
      'We could not set up your funding account just now. Please try again shortly.',
    );
  }

  try {
    return await prisma.depositAccount.create({
      data: {
        userId,
        provider: paymentProvider.name,
        providerRef: details.providerRef,
        accountNumber: details.accountNumber,
        accountName: details.accountName,
        bankName: details.bankName,
        bankCode: details.bankCode,
        currency: details.currency,
      },
    });
  } catch (err) {
    // Two concurrent first-loads of the wallet page. userId is unique, so the
    // loser re-reads the winner's row rather than issuing a second account —
    // which would leave the user with a number that quietly stops being watched.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return prisma.depositAccount.findUniqueOrThrow({ where: { userId } });
    }
    throw err;
  }
}

/**
 * Confirms one reference with the provider and credits it if it is real.
 *
 * The webhook's entire contribution is the reference string. Everything that
 * follows — that the payment exists, its amount, whose it is — comes from the
 * provider over an authenticated call.
 */
export async function creditFromReference(providerRef: string): Promise<void> {
  const payment = await paymentProvider.getPayment(providerRef);
  if (!payment) {
    // The expected outcome for a forged or stale webhook. Logged at info, not
    // warn: on an open endpoint this is background noise, not an incident.
    logger.info({ providerRef }, 'Deposit reference did not confirm — ignoring');
    return;
  }
  await applyPayment(payment);
}

/**
 * Credits a confirmed payment. Safe to call repeatedly with the same payment.
 *
 * The webhook, the sweep and a retry all funnel through here — one path, the
 * way applyDecision() is the single path for a KYC decision, because divergence
 * is how double-credit bugs are born.
 */
export async function applyPayment(payment: ConfirmedPayment): Promise<void> {
  const userId = await resolveUser(payment);
  if (!userId) {
    logger.warn(
      { providerRef: payment.providerRef, accountNumber: payment.accountNumber },
      'Deposit landed in an account we do not recognise',
    );
    return;
  }

  const rate = await getCurrentRate();
  if (!rate) {
    // Money has arrived and there is no honest number to credit it at. Recording
    // it PENDING loses nothing: the sweep completes it the moment a rate exists.
    // Dropping it here would mean a user's transfer simply vanished.
    await recordUncreditable(payment, userId);
    logger.error(
      { providerRef: payment.providerRef },
      'Deposit received with no USD/NGN rate set — held, not credited',
    );
    return;
  }

  const amountCents = usdCentsFromKobo(payment.amountMinor, rate.minorPerUnit);
  if (amountCents <= 0n) {
    logger.warn({ providerRef: payment.providerRef }, 'Deposit too small to credit a cent');
    return;
  }

  const wallet = await prisma.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  try {
    await prisma.$transaction(async (tx) => {
      const credited = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceCents: { increment: amountCents } },
      });

      const deposit = await tx.deposit.upsert({
        where: { providerRef: payment.providerRef },
        create: {
          userId,
          provider: paymentProvider.name,
          providerRef: payment.providerRef,
          amountCents,
          sourceAmountMinor: payment.amountMinor,
          sourceCurrency: payment.currency,
          rateMinorPerUnit: rate.minorPerUnit,
          status: 'SUCCESS',
          paidAt: payment.paidAt ?? new Date(),
        },
        update: {
          amountCents,
          rateMinorPerUnit: rate.minorPerUnit,
          status: 'SUCCESS',
          paidAt: payment.paidAt ?? new Date(),
        },
      });

      // The idempotency gate. `reference` is unique, so a second attempt at the
      // same payment throws here and rolls back the increment above — the
      // constraint does the work, not a check somebody has to remember to write.
      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          type: 'DEPOSIT',
          amountCents,
          balanceAfterCents: credited.balanceCents,
          reference: `dep_${payment.providerRef}`,
          description: 'Wallet funding',
          depositId: deposit.id,
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.info({ providerRef: payment.providerRef }, 'Deposit already credited');
      return;
    }
    throw err;
  }

  logger.info(
    { userId, providerRef: payment.providerRef, amountCents: amountCents.toString() },
    'Deposit credited',
  );
}

/** Records a receipt we cannot yet convert, so the sweep can finish it later. */
async function recordUncreditable(payment: ConfirmedPayment, userId: string): Promise<void> {
  await prisma.deposit.upsert({
    where: { providerRef: payment.providerRef },
    create: {
      userId,
      provider: paymentProvider.name,
      providerRef: payment.providerRef,
      amountCents: 0n,
      sourceAmountMinor: payment.amountMinor,
      sourceCurrency: payment.currency,
      status: 'PENDING',
      paidAt: payment.paidAt ?? new Date(),
    },
    update: {},
  });
}

/**
 * Which user a payment belongs to.
 *
 * Account number first: it is the actual destination, and it cannot be spoofed
 * by anything a payer controls. Email is the fallback because Klasha's
 * charge.completed carries `customer.email` and no account identifier — a gap
 * in their payload rather than a design choice here.
 */
async function resolveUser(payment: ConfirmedPayment): Promise<string | null> {
  if (payment.accountNumber) {
    const byAccount = await prisma.depositAccount.findFirst({
      where: { accountNumber: payment.accountNumber },
      select: { userId: true },
    });
    if (byAccount) return byAccount.userId;
  }
  if (payment.customerEmail) {
    const byEmail = await prisma.user.findUnique({
      where: { email: payment.customerEmail.toLowerCase() },
      select: { id: true },
    });
    if (byEmail) return byEmail.id;
  }
  return null;
}

/**
 * Sweeps recent provider transactions and credits anything not yet seen.
 *
 * Runs on wallet reads rather than on a schedule, following the same reasoning
 * as accrual: no cron means nothing to monitor, nothing to deploy separately,
 * and no window where the job is dead and nobody notices. Throttled, because a
 * polling UI would otherwise sweep on every render.
 *
 * Failures are swallowed. A wallet page must still render when the provider is
 * down — the balance shown is our own record, not theirs.
 */
export async function reconcileDeposits(): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  try {
    const payments = await paymentProvider.listRecentPayments(SWEEP_PAGE_SIZE);
    if (payments.length === 0) return;

    // One query rather than one per payment: the sweep runs on a page load.
    const known = await prisma.ledgerEntry.findMany({
      where: { reference: { in: payments.map((p) => `dep_${p.providerRef}`) } },
      select: { reference: true },
    });
    const seen = new Set(known.map((k) => k.reference));

    for (const payment of payments) {
      if (seen.has(`dep_${payment.providerRef}`)) continue;
      await applyPayment(payment);
    }
  } catch (err) {
    logger.warn({ err }, 'Deposit reconciliation sweep failed');
  }
}
