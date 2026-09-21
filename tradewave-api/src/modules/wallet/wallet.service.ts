import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { insufficientFunds } from '../../lib/errors';
import { formatUsd } from '../../lib/money';

export interface WalletView {
  balanceCents: bigint;
  /** Of the balance, how much cannot be spent yet. Referral bonuses only. */
  lockedCents: bigint;
  /** balanceCents - lockedCents. Derived here so the browser never does it. */
  availableCents: bigint;
  entries: {
    id: string;
    type: string;
    amountCents: bigint;
    balanceAfterCents: bigint;
    description: string;
    createdAt: Date;
  }[];
}

/**
 * Reads the wallet, creating it lazily on first access.
 *
 * Lazy rather than at registration so the Phase 1 signup transaction stays
 * untouched, and so a user who never funds anything carries no empty row.
 */
export async function getWallet(userId: string, entryLimit = 20): Promise<WalletView> {
  const wallet = await prisma.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId },
    include: {
      entries: { orderBy: { createdAt: 'desc' }, take: entryLimit },
      user: { select: { kycStatus: true } },
    },
  });

  // The lock binds only while unverified, so a wallet whose column has not been
  // zeroed yet must still report everything as available. Same rule the debit
  // guard applies, and it has to be the same rule or the screen and the server
  // disagree about what can be spent.
  const lockedCents = wallet.user.kycStatus === 'VERIFIED' ? 0n : wallet.lockedCents;

  return {
    balanceCents: wallet.balanceCents,
    lockedCents,
    availableCents: wallet.balanceCents - lockedCents,
    entries: wallet.entries.map((e) => ({
      id: e.id,
      type: e.type,
      amountCents: e.amountCents,
      balanceAfterCents: e.balanceAfterCents,
      description: e.description,
      createdAt: e.createdAt,
    })),
  };
}

/**
 * Takes money out of a wallet, refusing to reach into what is locked.
 *
 * ── Why this is raw SQL ───────────────────────────────────────────────────
 * The guard compares a column against two other columns and a value on a joined
 * row, which Prisma's field references cannot express. createInvestment already
 * claims a property allocation with raw SQL for exactly this reason, so this is
 * the established shape rather than a new one.
 *
 * The test still sits in the WHERE clause, so Postgres arbitrates a race rather
 * than JavaScript. What changes versus the Prisma form is only how losing looks:
 * zero rows returned instead of a thrown P2025.
 *
 * ── Why the lock is read through User ─────────────────────────────────────
 * lockedCents binds only while the owner is unverified. Reading the column on
 * its own would make spendability depend on the release having been written,
 * and a bonus credited in the same instant a KYC decision commits would then
 * stay locked forever — there is no second release event to repair it. Joining
 * User makes verification monotonic: it can only ever loosen, so a race is
 * always safe in the direction we want.
 *
 * ── updatedAt by hand ─────────────────────────────────────────────────────
 * Prisma applies @updatedAt client-side, so a raw UPDATE silently stops
 * maintaining it. The column is `timestamp without time zone` holding UTC, so
 * bare now() would write the server's local wall clock and drift it.
 *
 * Returns the balance after the debit.
 */
export async function debitSpendable(
  tx: Prisma.TransactionClient,
  params: {
    walletId: string;
    amountCents: bigint;
    /** Completes "… can be <verb> now." — e.g. 'withdrawn', 'invested'. */
    verb: string;
    /** Used when the wallet is simply short, with nothing locked. */
    shortfallMessage: string;
  },
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ balanceCents: bigint | string }[]>`
    UPDATE "Wallet" w
    SET "balanceCents" = w."balanceCents" - ${params.amountCents},
        -- Clamped, for the VERIFIED case only. While the lock binds, the guard
        -- below already guarantees balance-minus-lock covers the debit, so this
        -- is a no-op. Once somebody is verified the lock stops binding but the
        -- column may not have been zeroed yet, and spending down past a stale
        -- figure would otherwise violate the CHECK constraint and 500 a perfectly
        -- good withdrawal. Postgres evaluates every SET against the OLD row, so
        -- the subtraction here is the post-debit balance.
        "lockedCents"  = LEAST(w."lockedCents", w."balanceCents" - ${params.amountCents}),
        "updatedAt"    = now() at time zone 'UTC'
    FROM "User" u
    WHERE w.id = ${params.walletId}::uuid
      AND u.id = w."userId"
      AND w."balanceCents"
          - (CASE WHEN u."kycStatus" = 'VERIFIED' THEN 0 ELSE w."lockedCents" END)
          >= ${params.amountCents}
    RETURNING w."balanceCents"
  `;

  if (rows.length === 0) throw await refusalReason(tx, params);

  // The driver may hand back int8 as a string. Wrapping covers both without
  // depending on which, and a wrong answer here would be a wrong balanceAfter
  // snapshot on the ledger row.
  return BigInt(rows[0]!.balanceCents);
}

/**
 * Works out WHICH kind of "no" this was, for the message only.
 *
 * Two extra reads on a path that is already throwing. Worth it: the alternative
 * tells somebody their $260 withdrawal failed while their wallet plainly shows
 * $270, which is the single most likely support ticket this feature generates.
 */
async function refusalReason(
  tx: Prisma.TransactionClient,
  params: { walletId: string; amountCents: bigint; verb: string; shortfallMessage: string },
): Promise<Error> {
  const wallet = await tx.wallet.findUnique({
    where: { id: params.walletId },
    select: { balanceCents: true, lockedCents: true, user: { select: { kycStatus: true } } },
  });
  if (!wallet) return insufficientFunds(params.shortfallMessage);

  const locked = wallet.user.kycStatus === 'VERIFIED' ? 0n : wallet.lockedCents;

  if (locked > 0n && wallet.balanceCents >= params.amountCents) {
    return insufficientFunds(
      `${formatUsd(locked)} of your balance is referral earnings, which unlock when your identity is verified. ${formatUsd(
        wallet.balanceCents - locked,
      )} can be ${params.verb} now.`,
    );
  }
  return insufficientFunds(params.shortfallMessage);
}
