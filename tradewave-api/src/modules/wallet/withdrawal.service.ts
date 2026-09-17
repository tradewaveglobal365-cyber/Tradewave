import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { WithdrawalStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { formatNgn, formatUsd, koboFromUsdCents } from '../../lib/money';
import { getCurrentRate } from '../fx/fx.service';
import { paymentProvider } from '../../services/payments';
import {
  describeWindow,
  evaluateWindow,
  getWindow,
} from './withdrawal-window.service';
import { emailService } from '../../services/email';
import {
  badRequest,
  belowMinimumWithdrawal,
  insufficientFunds,
  noPayoutAccount,
  notFound,
  payoutAccountTooNew,
  withdrawalPending,
  withdrawalsClosed,
  withdrawalsUnavailable,
} from '../../lib/errors';

/**
 * Money leaving Tradewave.
 *
 * ── Where the dollars are, at every moment ────────────────────────────────
 * They leave the wallet the instant a withdrawal is REQUESTED, not when it is
 * paid. A "pending" balance that an investor can still spend is the bug that
 * lets the same dollars be withdrawn and invested at once, and no amount of
 * checking later fixes it. Every path that does not end in the money being
 * sent — rejected, refused, cancelled — puts it back with a matching ledger
 * entry, so the history reads as two events rather than as an edit.
 *
 * ── The one failure that must not be handled ──────────────────────────────
 * If the provider call throws, we do NOT know whether the money moved, and the
 * withdrawal is left exactly where it is. Returning it to the wallet on a
 * timeout is how somebody gets paid twice. See approveWithdrawal.
 */

/** Below this it costs more to send than it is worth. */
export const WITHDRAWAL_MINIMUM_CENTS = 1_000n; // $10

/**
 * Taken OUT of the amount, not added on top.
 *
 * So a $50 request debits $50 and sends $49 of naira. The alternative — debit
 * $51 to send $50 — makes "withdraw everything" impossible to express, because
 * the whole balance is never enough to withdraw the whole balance.
 */
export const WITHDRAWAL_FEE_CENTS = 100n; // $1

/** How long after the destination changes before money may be sent to it. */
export const PAYOUT_ACCOUNT_HOLD_MS = 24 * 60 * 60 * 1000;

/** Statuses where the money is out of the wallet and the outcome is undecided. */
const LIVE_STATUSES = ['REQUESTED', 'APPROVED'] as const satisfies readonly WithdrawalStatus[];

/** Last four only — enough to recognise, not enough to redirect money to. */
function mask(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

export interface WithdrawalView {
  id: string;
  status: WithdrawalStatus;
  amountCents: string;
  feeCents: string;
  /** What actually reaches the bank, in dollars. amount minus fee. */
  netCents: string;
  bankName: string;
  accountNumberMasked: string;
  accountName: string;
  /** Kobo, once pinned. Null while it is still an estimate. */
  destinationAmountMinor: string | null;
  rateMinorPerUnit: string | null;
  failureReason: string | null;
  rejectionReason: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
  paidAt: Date | null;
}

type WithdrawalRow = Prisma.WithdrawalGetPayload<Record<string, never>>;

function toView(row: WithdrawalRow): WithdrawalView {
  return {
    id: row.id,
    status: row.status,
    amountCents: row.amountCents.toString(),
    feeCents: row.feeCents.toString(),
    netCents: (row.amountCents - row.feeCents).toString(),
    bankName: row.bankName,
    accountNumberMasked: mask(row.accountNumber),
    accountName: row.accountName,
    destinationAmountMinor: row.destinationAmountMinor?.toString() ?? null,
    rateMinorPerUnit: row.rateMinorPerUnit?.toString() ?? null,
    failureReason: row.failureReason,
    rejectionReason: row.rejectionReason,
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
    paidAt: row.paidAt,
  };
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** How much history the wallet screen carries. */
const HISTORY_LIMIT = 20;

export interface WithdrawalContext {
  minimumCents: string;
  feeCents: string;
  balanceCents: string;
  /** The payout schedule, and whether it is open right now. */
  window: {
    open: boolean;
    opensAt: Date | null;
    closesAt: Date | null;
    schedule: string;
    enabled: boolean;
    daysOfWeek: number[];
    timezone: string;
  };
  payoutAccount: { bankName: string; accountNumberMasked: string; accountName: string } | null;
  /** Set while the destination is inside its hold. Null once it has lifted. */
  holdUntil: Date | null;
  /** Kobo per dollar, for the estimate. Null when no rate is set. */
  rateMinorPerUnit: string | null;
  /** The one in flight, if any. */
  live: WithdrawalView | null;
  history: WithdrawalView[];
}

/**
 * Everything the withdrawal screen needs, in one round trip.
 *
 * Assembled here rather than left to the client to stitch together from four
 * endpoints: which of the five possible states the screen is in depends on all
 * of them at once, and a UI that resolves that from four separate loads shows
 * the wrong thing while the last one is in flight.
 */
export async function getWithdrawalContext(userId: string): Promise<WithdrawalContext> {
  const [wallet, account, withdrawals, rate, window] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId }, select: { balanceCents: true } }),
    prisma.payoutAccount.findUnique({ where: { userId } }),
    prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      take: HISTORY_LIMIT,
    }),
    getCurrentRate(),
    getWindow(),
  ]);

  const windowState = evaluateWindow(window);

  const holdUntil = account
    ? new Date(account.destinationChangedAt.getTime() + PAYOUT_ACCOUNT_HOLD_MS)
    : null;

  const live = withdrawals.find((w) => (LIVE_STATUSES as readonly string[]).includes(w.status));

  return {
    minimumCents: WITHDRAWAL_MINIMUM_CENTS.toString(),
    feeCents: WITHDRAWAL_FEE_CENTS.toString(),
    balanceCents: (wallet?.balanceCents ?? 0n).toString(),
    window: {
      open: windowState.open,
      opensAt: windowState.opensAt,
      closesAt: windowState.closesAt,
      schedule: describeWindow(window),
      enabled: window.enabled,
      daysOfWeek: window.daysOfWeek,
      timezone: window.timezone,
    },
    payoutAccount: account
      ? {
          bankName: account.bankName,
          accountNumberMasked: mask(account.accountNumber),
          accountName: account.accountName,
        }
      : null,
    holdUntil: holdUntil && holdUntil > new Date() ? holdUntil : null,
    rateMinorPerUnit: rate?.minorPerUnit.toString() ?? null,
    live: live ? toView(live) : null,
    history: withdrawals.map(toView),
  };
}

// ── Requesting ───────────────────────────────────────────────────────────────

export async function requestWithdrawal(
  userId: string,
  amountCents: bigint,
): Promise<WithdrawalView> {
  if (amountCents < WITHDRAWAL_MINIMUM_CENTS) {
    throw belowMinimumWithdrawal(formatUsd(WITHDRAWAL_MINIMUM_CENTS));
  }

  const account = await prisma.payoutAccount.findUnique({ where: { userId } });
  if (!account) throw noPayoutAccount();

  // The schedule gates asking, not just paying. See withdrawal-window.service
  // for why: a balance that drops on Tuesday for money that arrives on Friday
  // is indistinguishable, from the investor's side, from not being paid at all.
  const window = await getWindow();
  const state = evaluateWindow(window);
  if (!state.open) throw withdrawalsClosed(state.opensAt, describeWindow(window));

  const holdUntil = new Date(account.destinationChangedAt.getTime() + PAYOUT_ACCOUNT_HOLD_MS);
  if (holdUntil > new Date()) throw payoutAccountTooNew(holdUntil);

  // One at a time. Two concurrent requests could in principle both get past
  // this read — there is no partial unique index to lean on — but the money is
  // safe either way, because the balance guard below is what actually stops an
  // overdraft, and an admin reviews both rows before either is sent.
  const live = await prisma.withdrawal.findFirst({
    where: { userId, status: { in: [...LIVE_STATUSES] } },
  });
  if (live) throw withdrawalPending();

  const wallet = await prisma.wallet.upsert({ where: { userId }, update: {}, create: { userId } });

  // Generated up front because the ledger reference has to name the withdrawal,
  // and the reference has to be deterministic for the unique constraint to be
  // the idempotency gate rather than a check somebody has to remember.
  const withdrawalId = randomUUID();

  const row = await prisma.$transaction(async (tx) => {
    // The balance filter sits in WHERE, so a concurrent request that already
    // spent the money finds no matching row and throws P2025 — Postgres
    // arbitrates rather than JavaScript.
    let debited;
    try {
      debited = await tx.wallet.update({
        where: { id: wallet.id, balanceCents: { gte: amountCents } },
        data: { balanceCents: { decrement: amountCents } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw insufficientFunds('Your wallet balance is not enough for this withdrawal.');
      }
      throw err;
    }

    const withdrawal = await tx.withdrawal.create({
      data: {
        id: withdrawalId,
        userId,
        amountCents,
        feeCents: WITHDRAWAL_FEE_CENTS,
        provider: paymentProvider.name,
        requestId: `twd_${withdrawalId}`,
        // Snapshotted. The payout account is replaced in place, so reading the
        // bank off the relation later would rewrite history every time somebody
        // changes where they bank.
        bankCode: account.bankCode,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: 'WITHDRAWAL',
        amountCents: -amountCents, // debits are negative
        balanceAfterCents: debited.balanceCents,
        reference: `wdr_${withdrawalId}`,
        description: `Withdrawal to ${account.bankName} ${mask(account.accountNumber)}`,
        withdrawalId,
      },
    });

    return withdrawal;
  });

  logger.info(
    { userId, withdrawalId, amountCents: amountCents.toString() },
    'Withdrawal requested',
  );

  // After the commit, never inside it — an email provider being slow must not
  // hold a transaction that has a wallet row locked.
  await notify(userId, async (user) => {
    await emailService.sendWithdrawalRequested({
      to: user.email,
      firstName: user.firstName,
      amount: formatUsd(amountCents),
      fee: formatUsd(WITHDRAWAL_FEE_CENTS),
      bankName: account.bankName,
      accountNumberMasked: mask(account.accountNumber),
      url: `${env.WEB_ORIGIN}/wallet`,
    });
  });

  return toView(row);
}

/** The investor changing their mind, while nothing has been sent yet. */
export async function cancelWithdrawal(userId: string, withdrawalId: string): Promise<WithdrawalView> {
  const row = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!row || row.userId !== userId) throw notFound('Withdrawal not found.');
  if (row.status !== 'REQUESTED') {
    throw badRequest('This withdrawal is already being processed and can no longer be cancelled.');
  }
  return returnMoney(withdrawalId, 'CANCELLED', null);
}

// ── Returning the money ──────────────────────────────────────────────────────

/**
 * The single undo, shared by reject, refuse and cancel.
 *
 * One function rather than three because the three differ only in who decided.
 * Three copies of "credit the wallet and write the entry" is three chances for
 * one of them to drift into crediting twice or not at all.
 */
async function returnMoney(
  withdrawalId: string,
  status: Extract<WithdrawalStatus, 'REJECTED' | 'FAILED' | 'CANCELLED'>,
  reason: string | null,
  decidedByUserId?: string,
): Promise<WithdrawalView> {
  const updated = await prisma.$transaction(async (tx) => {
    // Conditional on the current status, so two callers racing to return the
    // same money — a webhook and the sweep, say — cannot both win.
    const claimed = await tx.withdrawal.updateMany({
      where: { id: withdrawalId, status: { in: [...LIVE_STATUSES] } },
      data: {
        status,
        decidedAt: new Date(),
        ...(decidedByUserId ? { decidedByUserId } : {}),
        ...(status === 'REJECTED' ? { rejectionReason: reason } : {}),
        ...(status === 'FAILED' ? { failureReason: reason } : {}),
      },
    });
    if (claimed.count === 0) {
      throw badRequest('This withdrawal has already been settled.');
    }

    const row = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: row.userId } });

    const credited = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balanceCents: { increment: row.amountCents } },
    });

    // Unique, so a second return is refused by the database and rolls back the
    // credit above rather than quietly paying the money back twice.
    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: 'ADJUSTMENT',
        amountCents: row.amountCents,
        balanceAfterCents: credited.balanceCents,
        reference: `wdr_rev_${withdrawalId}`,
        description: 'Withdrawal returned',
        withdrawalId,
      },
    });

    return row;
  });

  logger.info({ withdrawalId, status, reason }, 'Withdrawal money returned to wallet');

  if (status !== 'CANCELLED') {
    await notify(updated.userId, async (user) => {
      await emailService.sendWithdrawalSettled({
        to: user.email,
        firstName: user.firstName,
        paid: false,
        amount: formatUsd(updated.amountCents),
        bankName: updated.bankName,
        accountNumberMasked: mask(updated.accountNumber),
        reason: reason ?? undefined,
        url: `${env.WEB_ORIGIN}/wallet`,
      });
    });
  }

  return toView(updated);
}

// ── Sending ──────────────────────────────────────────────────────────────────

/**
 * Releases a withdrawal: pins the rate, and asks the provider to send it.
 *
 * The rate is pinned HERE rather than at request time, mirroring deposits,
 * which convert at the moment money moves. It means a rate set on Tuesday does
 * not bind a Thursday payout, and it is why the investor is shown an estimate
 * up to this point rather than a promise.
 */
export async function approveWithdrawal(
  withdrawalId: string,
  adminUserId: string,
): Promise<WithdrawalView> {
  const row = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!row) throw notFound('Withdrawal not found.');
  if (row.status !== 'REQUESTED') {
    throw badRequest(`This withdrawal is ${row.status.toLowerCase()} and cannot be approved.`);
  }

  const rate = await getCurrentRate();
  if (!rate) {
    // Fail closed, exactly as a deposit does with no rate. There is no
    // defensible naira figure to send, and guessing one moves real money.
    throw withdrawalsUnavailable(
      'No USD/NGN rate is set, so there is no defensible naira figure to send. Set a rate first.',
    );
  }

  // Floored to whole naira, because that is the unit Klasha's payout endpoint
  // accepts. Pinning the rounded figure means the number stored is exactly the
  // number sent — a stored kobo amount that gets rounded at the edge is a
  // reconciliation problem nobody can explain months later.
  const netCents = row.amountCents - row.feeCents;
  const kobo = koboFromUsdCents(netCents, rate.minorPerUnit);
  const destinationAmountMinor = (kobo / 100n) * 100n;
  if (destinationAmountMinor <= 0n) {
    throw badRequest('That withdrawal converts to less than one naira at the current rate.');
  }

  // Claim it before calling out. Two admins clicking Approve at the same moment
  // must not produce two transfers, and only one updateMany can match.
  const claimed = await prisma.withdrawal.updateMany({
    where: { id: withdrawalId, status: 'REQUESTED' },
    data: {
      status: 'APPROVED',
      decidedAt: new Date(),
      decidedByUserId: adminUserId,
      destinationAmountMinor,
      rateMinorPerUnit: rate.minorPerUnit,
    },
  });
  if (claimed.count === 0) throw badRequest('This withdrawal has already been actioned.');

  let result;
  try {
    result = await paymentProvider.sendPayout({
      requestId: row.requestId,
      amountMinor: destinationAmountMinor,
      currency: 'NGN',
      country: 'NG',
      bankCode: row.bankCode,
      bankName: row.bankName,
      accountNumber: row.accountNumber,
      accountName: row.accountName,
      description: 'Tradewave withdrawal',
    });
  } catch (err) {
    // We do not know whether the money moved. The row stays APPROVED and the
    // money stays out of the wallet — reconcileWithdrawals will settle it once
    // the provider can tell us. Returning it here is how someone gets paid
    // twice, so this branch deliberately changes nothing.
    logger.error(
      { err, withdrawalId },
      'Payout call failed with an unknown outcome — left approved, NOT returned',
    );
    throw withdrawalsUnavailable(
      'We could not confirm whether the transfer went through. It has been left in progress and will settle automatically — check the provider before sending it again.',
    );
  }

  if (result.state === 'refused') {
    logger.warn({ withdrawalId, reason: result.reason }, 'Provider refused a payout');
    return returnMoney(withdrawalId, 'FAILED', result.reason, adminUserId);
  }

  if (result.providerRef) {
    try {
      await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: { providerRef: result.providerRef },
      });
    } catch (err) {
      // providerRef is unique. A collision means the provider handed us a
      // reference already attached to another withdrawal, which is worth
      // shouting about but must not undo a transfer that has been accepted.
      logger.error({ err, withdrawalId, providerRef: result.providerRef }, 'Could not store the provider reference');
    }
  }

  return toView(await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } }));
}

export async function rejectWithdrawal(
  withdrawalId: string,
  adminUserId: string,
  reason: string,
): Promise<WithdrawalView> {
  const row = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!row) throw notFound('Withdrawal not found.');
  if (row.status !== 'REQUESTED') {
    throw badRequest(
      `This withdrawal is ${row.status.toLowerCase()}. Only one that has not been sent can be rejected.`,
    );
  }
  return returnMoney(withdrawalId, 'REJECTED', reason, adminUserId);
}

/**
 * The manual rail: somebody paid this from a bank app rather than through the
 * provider.
 *
 * Only from APPROVED. A FAILED withdrawal has already had its money returned to
 * the wallet, so marking it paid would send money the investor can also still
 * spend — they have to request again instead.
 */
export async function markWithdrawalPaid(
  withdrawalId: string,
  adminUserId: string,
  note?: string,
): Promise<WithdrawalView> {
  const row = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!row) throw notFound('Withdrawal not found.');
  if (row.status === 'FAILED') {
    throw badRequest(
      'This withdrawal failed and the money is back in the investor’s wallet. Ask them to request it again rather than marking it paid.',
    );
  }
  if (row.status !== 'APPROVED') {
    throw badRequest(
      `This withdrawal is ${row.status.toLowerCase()}. Approve it before marking it paid.`,
    );
  }
  return settle(withdrawalId, { manual: true, note, decidedByUserId: adminUserId });
}

/** Marks a withdrawal paid. Idempotent — a webhook and the sweep both call it. */
async function settle(
  withdrawalId: string,
  options: { manual?: boolean; note?: string; decidedByUserId?: string } = {},
): Promise<WithdrawalView> {
  const claimed = await prisma.withdrawal.updateMany({
    where: { id: withdrawalId, status: { in: [...LIVE_STATUSES] } },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      ...(options.manual ? { provider: 'manual' } : {}),
      ...(options.note ? { failureReason: options.note } : {}),
      ...(options.decidedByUserId ? { decidedByUserId: options.decidedByUserId } : {}),
    },
  });

  const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
  if (claimed.count === 0) return toView(row); // already settled; say so quietly

  logger.info({ withdrawalId, manual: options.manual === true }, 'Withdrawal paid');

  await notify(row.userId, async (user) => {
    await emailService.sendWithdrawalSettled({
      to: user.email,
      firstName: user.firstName,
      paid: true,
      amount: formatUsd(row.amountCents),
      bankName: row.bankName,
      accountNumberMasked: mask(row.accountNumber),
      naira: row.destinationAmountMinor ? formatNgn(row.destinationAmountMinor) : undefined,
      rate: row.rateMinorPerUnit
        ? `${formatNgn(row.rateMinorPerUnit)} per $1`
        : undefined,
      url: `${env.WEB_ORIGIN}/wallet`,
    });
  });

  return toView(row);
}

// ── Settling from the provider ───────────────────────────────────────────────

/**
 * A payout webhook.
 *
 * Matched on the PROVIDER's reference, because that is what Klasha sends — it
 * does not echo our requestId back. A reference we do not recognise is logged
 * and dropped: the endpoint is public and unsigned, so an unknown reference is
 * as likely to be noise as anything else.
 */
export async function settleFromWebhook(
  providerRef: string,
  state: 'pending' | 'successful' | 'failed',
): Promise<void> {
  if (state === 'pending') return;

  const row = await prisma.withdrawal.findUnique({ where: { providerRef } });
  if (!row) {
    logger.info({ providerRef }, 'Payout webhook for an unknown reference — ignored');
    return;
  }
  if (!(LIVE_STATUSES as readonly string[]).includes(row.status)) return;

  if (state === 'successful') await settle(row.id);
  else await returnMoney(row.id, 'FAILED', 'The bank transfer failed.');
}

/** How often the sweep is allowed to run, and how much it looks at. */
const SWEEP_INTERVAL_MS = 30_000;
const SWEEP_PAGE_SIZE = 50;
let lastSweepAt = 0;

/**
 * Asks the provider about anything still in flight.
 *
 * The webhook is unsigned, unacknowledged and can simply be lost, so it is an
 * accelerator and this is the path that actually guarantees a withdrawal
 * reaches an end state. Same shape as reconcileDeposits, for the same reason.
 */
export async function reconcileWithdrawals(now = Date.now()): Promise<void> {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  try {
    const pending = await prisma.withdrawal.findMany({
      where: { status: 'APPROVED' },
      orderBy: { requestedAt: 'asc' },
      take: SWEEP_PAGE_SIZE,
    });

    for (const row of pending) {
      const status = await paymentProvider.getPayout(row.requestId);
      // Null means the provider could not tell us. Leaving the row alone is the
      // only safe reading: it is not evidence of failure.
      if (!status || status.state === 'pending') continue;

      if (status.state === 'successful') {
        if (status.providerRef && !row.providerRef) {
          await prisma.withdrawal
            .update({ where: { id: row.id }, data: { providerRef: status.providerRef } })
            .catch(() => undefined);
        }
        await settle(row.id);
      } else {
        await returnMoney(row.id, 'FAILED', status.reason ?? 'The bank transfer failed.');
      }
    }
  } catch (err) {
    // A sweep is opportunistic. It runs off a page load, and a failure here
    // must never be what the admin sees instead of their queue.
    logger.warn({ err }, 'Withdrawal reconciliation sweep failed');
  }
}

// ── Plumbing ─────────────────────────────────────────────────────────────────

/** Sends a notification, and never lets a mail failure become a money failure. */
async function notify(
  userId: string,
  send: (user: { email: string; firstName: string }) => Promise<void>,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true },
    });
    if (user) await send(user);
  } catch (err) {
    logger.error({ err, userId }, 'Could not send a withdrawal email');
  }
}
