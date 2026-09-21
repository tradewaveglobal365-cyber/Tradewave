import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { formatUsd } from '../../lib/money';
import { emailService } from '../../services/email';
import { revokeAllSessions } from '../../services/token.service';
import { badRequest, insufficientFunds, notFound } from '../../lib/errors';
import { recordAction, recordActionTx } from './audit.service';

/**
 * Doing things to an investor's account.
 *
 * Every function here takes the acting admin and a REASON, and every one writes
 * an AdminAction. That is not ceremony: these are the only operations in the
 * product where one person can reach into another person's money or access, and
 * "who did this and why" has to survive the conversation it eventually causes.
 *
 * Nothing here reimplements money movement. A balance adjustment writes a
 * LedgerEntry through the same invariants everything else uses — the rule
 * admin.service states, that an admin action and a webhook must not drift into
 * behaving differently.
 */

/** Shortest reason worth recording. Anything less is a blank in the audit log. */
export const MIN_REASON_LENGTH = 5;

export type StatusAction = 'suspend' | 'reinstate' | 'restrict' | 'unrestrict';
export type WithdrawalAction = 'block' | 'unblock';

async function loadInvestor(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      status: true,
      role: true,
      emailVerifiedAt: true,
      kycStatus: true,
      withdrawalsBlockedAt: true,
    },
  });
  if (!user) throw notFound('That investor does not exist.');
  return user;
}

/** Nobody may act on their own account. */
function refuseSelf(actorId: string, subjectId: string): void {
  if (actorId === subjectId) {
    throw badRequest('You cannot do that to your own account.');
  }
}

// ── Access ───────────────────────────────────────────────────────────────────

export async function setAccountStatus(params: {
  actorId: string;
  subjectId: string;
  action: StatusAction;
  reason: string;
}): Promise<{ status: string }> {
  refuseSelf(params.actorId, params.subjectId);
  const user = await loadInvestor(params.subjectId);

  const next =
    params.action === 'suspend'
      ? 'SUSPENDED'
      : params.action === 'restrict'
        ? 'RESTRICTED'
        : 'ACTIVE';

  if (params.action === 'reinstate' || params.action === 'unrestrict') {
    if (user.status !== 'SUSPENDED' && user.status !== 'RESTRICTED') {
      throw badRequest('That account is not suspended or restricted.');
    }
  } else if (user.status === next) {
    throw badRequest(`That account is already ${next.toLowerCase()}.`);
  }

  // PENDING_VERIFICATION must survive reinstatement: somebody who never
  // confirmed their email does not become verified by being unfrozen.
  const restored = user.emailVerifiedAt ? 'ACTIVE' : 'PENDING_VERIFICATION';
  const status = next === 'ACTIVE' ? restored : next;

  await prisma.user.update({ where: { id: user.id }, data: { status } });

  // Revoking is what makes a freeze immediate. requireActive reads the database
  // now, so it would bite on the next request anyway — but an outstanding
  // access token still carries a signature we do not re-check, and a refresh
  // token would otherwise keep minting new ones for thirty days.
  let sessionsEnded = 0;
  if (status === 'SUSPENDED' || status === 'RESTRICTED') {
    sessionsEnded = await revokeAllSessions(user.id);
  }

  await recordAction({
    type:
      params.action === 'suspend'
        ? 'SUSPEND'
        : params.action === 'restrict'
          ? 'RESTRICT'
          : params.action === 'reinstate'
            ? 'REINSTATE'
            : 'UNRESTRICT',
    actorId: params.actorId,
    subjectId: user.id,
    reason: params.reason,
    detail: { from: user.status, to: status, sessionsEnded },
  });

  logger.info(
    { adminUserId: params.actorId, userId: user.id, from: user.status, to: status },
    'Account status changed',
  );

  await notify(user, async () => {
    await emailService.sendAccountStatusChanged({
      to: user.email,
      firstName: user.firstName,
      status: status as 'ACTIVE' | 'PENDING_VERIFICATION' | 'RESTRICTED' | 'SUSPENDED',
      reason: params.reason,
      url: `${env.WEB_ORIGIN}/dashboard`,
    });
  });

  return { status };
}

export async function setWithdrawalBlock(params: {
  actorId: string;
  subjectId: string;
  action: WithdrawalAction;
  reason: string;
}): Promise<{ blocked: boolean }> {
  refuseSelf(params.actorId, params.subjectId);
  const user = await loadInvestor(params.subjectId);

  const blocked = params.action === 'block';
  if (blocked === (user.withdrawalsBlockedAt !== null)) {
    throw badRequest(
      blocked
        ? 'Withdrawals are already blocked for that account.'
        : 'Withdrawals are not blocked for that account.',
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { withdrawalsBlockedAt: blocked ? new Date() : null },
  });

  await recordAction({
    type: blocked ? 'BLOCK_WITHDRAWALS' : 'UNBLOCK_WITHDRAWALS',
    actorId: params.actorId,
    subjectId: user.id,
    reason: params.reason,
  });

  logger.info(
    { adminUserId: params.actorId, userId: user.id, blocked },
    'Withdrawal block changed',
  );

  // The reason is mandatory on this action and, until now, was written only to
  // the audit log — so the person it was about learned of the block when a
  // withdrawal failed, and never learned why. Telling them is the whole point
  // of collecting a reason.
  await notify(user, async () => {
    await emailService.sendWithdrawalsBlocked({
      to: user.email,
      firstName: user.firstName,
      blocked,
      reason: params.reason,
      url: `${env.WEB_ORIGIN}/wallet`,
    });
  });

  return { blocked };
}

// ── Identity ─────────────────────────────────────────────────────────────────

/**
 * Sends somebody back through identity verification.
 *
 * EXPIRED, not REJECTED. The schema's own words for EXPIRED: "Retryable, and
 * deliberately distinct from REJECTED: a timeout is not a failed check, must not
 * read as one to the user, and must not consume a retry." An admin deciding to
 * re-check somebody is not a failed check either, and telling them their
 * document was rejected when it was not is a lie that generates a support
 * ticket.
 *
 * EXPIRED also keeps the KYC half of the name lock permissive, which matters —
 * a forced redo is very often BECAUSE the name is wrong. Note it is only half:
 * an investor who has already set a payout account stays locked regardless, and
 * fixing their name is a support job. That is the intended order, since the
 * whole reason the payout half exists is that a name must not be edited to
 * match an account after the fact.
 *
 * kycResetAt is stamped so the attempt caps in kyc.service count only what the
 * investor has tried SINCE this moment. Otherwise our decision would quietly
 * spend one of their ten lifetime attempts.
 *
 * The live provider session is left alone, exactly as the stale-review path
 * does: applyDecision only ever transitions a PENDING row, so a late decision
 * on the old session cannot overwrite the new attempt.
 */
export async function forceKycReverification(params: {
  actorId: string;
  subjectId: string;
  reason: string;
}): Promise<{ kycStatus: string }> {
  const user = await loadInvestor(params.subjectId);

  if (user.kycStatus === 'NOT_STARTED') {
    throw badRequest('That investor has not verified their identity yet.');
  }

  // Referral earnings already released are NOT re-locked.
  //
  // Deliberate. The release happened, the dollars are mixed into a balance that
  // may already be invested, and clawing back an encumbrance on money somebody
  // was told was theirs is a support conversation rather than a control. Staff
  // who need to stop this person spending have setWithdrawalBlock and RESTRICTED,
  // both of which say what they do.
  await prisma.user.update({
    where: { id: user.id },
    data: { kycStatus: 'EXPIRED', kycVerifiedAt: null, kycResetAt: new Date() },
  });

  await recordAction({
    type: 'FORCE_KYC_REVERIFICATION',
    actorId: params.actorId,
    subjectId: user.id,
    reason: params.reason,
    detail: { from: user.kycStatus },
  });

  logger.info(
    { adminUserId: params.actorId, userId: user.id, from: user.kycStatus },
    'Identity verification reset',
  );

  await notify(user, async () => {
    await emailService.sendKycResetRequired({
      to: user.email,
      firstName: user.firstName,
      reason: params.reason,
      url: `${env.WEB_ORIGIN}/verify-identity`,
    });
  });

  return { kycStatus: 'EXPIRED' };
}

export async function markEmailVerified(params: {
  actorId: string;
  subjectId: string;
  reason: string;
}): Promise<{ emailVerified: boolean }> {
  const user = await loadInvestor(params.subjectId);
  if (user.emailVerifiedAt) throw badRequest('That email is already verified.');

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      // Only lift PENDING_VERIFICATION. Confirming an email must never quietly
      // un-suspend or un-restrict somebody.
      ...(user.status === 'PENDING_VERIFICATION' ? { status: 'ACTIVE' } : {}),
    },
  });

  await recordAction({
    type: 'VERIFY_EMAIL',
    actorId: params.actorId,
    subjectId: user.id,
    reason: params.reason,
  });

  logger.info({ adminUserId: params.actorId, userId: user.id }, 'Email marked verified by admin');
  return { emailVerified: true };
}

// ── Money ────────────────────────────────────────────────────────────────────

/**
 * Moves money into or out of a wallet by hand.
 *
 * The most dangerous operation in the product: it is the only one that creates
 * or destroys money with no counterparty. So it is the only one whose audit row
 * is written INSIDE the transaction — everywhere else a failed audit write is
 * survivable, and here it would mean money existing that nobody is recorded as
 * having made.
 *
 * A debit uses the same conditional update createInvestment and
 * requestWithdrawal rely on, so an overdraw matches zero rows and throws rather
 * than taking a balance negative — an outcome every screen and every sum in
 * this codebase assumes cannot happen.
 */
export async function adjustBalance(params: {
  actorId: string;
  subjectId: string;
  /** Signed. Positive credits the investor, negative debits them. */
  amountCents: bigint;
  reason: string;
}): Promise<{ balanceCents: string; amountCents: string }> {
  const user = await loadInvestor(params.subjectId);
  if (params.amountCents === 0n) throw badRequest('Enter an amount other than zero.');

  const wallet = await prisma.wallet.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  const adjustmentId = randomUUID();
  const credit = params.amountCents > 0n;

  const balanceAfter = await prisma.$transaction(async (tx) => {
    /**
     * Guarded on the FULL balance, deliberately — not the spendable one.
     *
     * Everywhere else a debit refuses to reach into locked referral earnings.
     * Here it must: an admin clawing back a bonus that should never have been
     * paid is the one operation that has to work regardless of an encumbrance
     * WE placed on it. Refusing would make a fraudulent referral the single
     * thing staff cannot reverse.
     *
     * So the lock follows the money down instead. LEAST clamps rather than
     * refuses, and it clamps in the same statement as the debit so a referral
     * bonus landing concurrently cannot slip between a read and a write.
     * Postgres evaluates every SET expression against the OLD row, so
     * "balanceCents" + amount on the right-hand side is the POST-debit balance.
     *
     * The clamp is one-way. Crediting the money back later does not restore the
     * lock: the dollars it encumbered are gone, and re-locking a balance
     * somebody may have already committed elsewhere is a support conversation,
     * not a control.
     *
     * updatedAt is set by hand because Prisma applies @updatedAt client-side and
     * a raw UPDATE would silently stop maintaining it. The column is `timestamp
     * without time zone` holding UTC, so bare now() would drift it.
     */
    const rows = await tx.$queryRaw<{ balanceCents: bigint | string }[]>`
      UPDATE "Wallet"
      SET "balanceCents" = "balanceCents" + ${params.amountCents},
          "lockedCents"  = LEAST("lockedCents", "balanceCents" + ${params.amountCents}),
          "updatedAt"    = now() at time zone 'UTC'
      WHERE id = ${wallet.id}::uuid
        ${credit ? Prisma.empty : Prisma.sql`AND "balanceCents" >= ${-params.amountCents}`}
      RETURNING "balanceCents"
    `;
    if (rows.length === 0) {
      throw insufficientFunds(
        'That debit is more than the investor holds. A balance cannot go negative.',
      );
    }
    const balanceCents = BigInt(rows[0]!.balanceCents);

    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: 'ADJUSTMENT',
        amountCents: params.amountCents,
        balanceAfterCents: balanceCents,
        reference: `adj_${adjustmentId}`,
        // The reason reaches the investor's own transaction list, so it is
        // written to be read by them.
        description: params.reason,
      },
    });

    await recordActionTx(tx, {
      type: 'ADJUST_BALANCE',
      actorId: params.actorId,
      subjectId: user.id,
      reason: params.reason,
      detail: {
        amountCents: params.amountCents.toString(),
        balanceAfterCents: balanceCents.toString(),
        adjustmentId,
      },
    });

    return balanceCents;
  });

  logger.info(
    {
      adminUserId: params.actorId,
      userId: user.id,
      amountCents: params.amountCents.toString(),
    },
    'Balance adjusted by admin',
  );

  await notify(user, async () => {
    await emailService.sendBalanceAdjusted({
      to: user.email,
      firstName: user.firstName,
      credit,
      amount: formatUsd(credit ? params.amountCents : -params.amountCents),
      newBalance: formatUsd(balanceAfter),
      reason: params.reason,
      url: `${env.WEB_ORIGIN}/wallet`,
    });
  });

  return {
    balanceCents: balanceAfter.toString(),
    amountCents: params.amountCents.toString(),
  };
}

// ── Plumbing ─────────────────────────────────────────────────────────────────

/** Never lets a mail failure undo an action that has already happened. */
async function notify(
  user: { id: string },
  send: () => Promise<void>,
): Promise<void> {
  try {
    await send();
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Could not send an account notification');
  }
}
