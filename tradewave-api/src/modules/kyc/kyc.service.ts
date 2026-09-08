import type { KycStatus, KycVerification } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { hashIdentifier } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { tooManyRequests } from '../../lib/errors';
import { kycProvider } from '../../services/kyc';
import type { KycDecision } from '../../services/kyc/types';

/**
 * Attempt caps live here rather than in the express limiter because that limiter
 * is memory-backed (resets on deploy, not shared across replicas) and is skipped
 * entirely under test — see middleware/rate-limit.ts:15. Every provider check
 * costs real money, so the ceiling that actually protects the budget has to be
 * one the database enforces and the tests can exercise.
 */
const MAX_ATTEMPTS_PER_DAY = 3;
const MAX_ATTEMPTS_LIFETIME = 10;

/** Reconciliation thresholds — see reconcile() for why both exist. */
const RECONCILE_AFTER_MS = 20_000;
const RECONCILE_INTERVAL_MS = 10_000;
const MAX_POLLS = 60;

export interface KycStatusView {
  status: KycStatus;
  documentLast4: string | null;
  reason: string | null;
  redirectUrl: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  canRetry: boolean;
  attemptsRemaining: number;
}

function view(
  status: KycStatus,
  latest: KycVerification | null,
  attempts: number,
): KycStatusView {
  const remaining = Math.max(0, MAX_ATTEMPTS_LIFETIME - attempts);
  return {
    status,
    documentLast4: latest?.documentLast4 ?? null,
    reason: latest?.rejectionReason ?? null,
    // Only offer the link back while the session can still be finished.
    redirectUrl: status === 'PENDING' ? (latest?.redirectUrl ?? null) : null,
    submittedAt: latest?.submittedAt ?? null,
    decidedAt: latest?.decidedAt ?? null,
    canRetry:
      remaining > 0 &&
      (status === 'NOT_STARTED' || status === 'REJECTED' || status === 'EXPIRED'),
    attemptsRemaining: remaining,
  };
}

/**
 * Applies a provider decision. The webhook, the reconciliation poll and the
 * return-from-provider page load all funnel through here — one state machine with
 * three triggers, because divergence is how double-apply bugs are born.
 *
 * Safe to call repeatedly with the same decision.
 */
export async function applyDecision(decision: KycDecision): Promise<void> {
  const row = await prisma.kycVerification.findUnique({
    where: { id: decision.reference },
    select: { id: true, userId: true, status: true },
  });
  // Unknown reference: a stale session, or not ours. Callers answer 200 anyway —
  // a 4xx would make the provider retry this forever.
  if (!row) {
    logger.warn({ reference: decision.reference }, 'Decision for unknown verification');
    return;
  }
  if (decision.status === 'PENDING') return;

  // The dedupe key is the number the PROVIDER read off the verified document, so
  // it can only be known now — the user never typed one. Hashing here rather than
  // at submit time also means the value has passed the document authenticity
  // checks before it is trusted as an identity.
  const documentHash = decision.documentNumber
    ? hashIdentifier(decision.documentNumber)
    : null;

  let status = decision.status;
  let reason = decision.rejectionReason ?? null;

  if (status === 'VERIFIED' && documentHash) {
    const claimedByOther = await prisma.kycVerification.findFirst({
      where: { documentHash, status: 'VERIFIED', userId: { not: row.userId } },
      select: { id: true },
    });
    if (claimedByOther) {
      // Deliberately does not say whose account — that would leak membership.
      status = 'REJECTED';
      reason = 'This document is already linked to another verified account.';
      logger.warn(
        { verificationId: row.id },
        'KYC rejected: document already verified on another account',
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    // Conditional update rather than read-then-write: only ever transitions OUT
    // of PENDING, so a replayed webhook updates zero rows and does nothing.
    const { count } = await tx.kycVerification.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: {
        status,
        rejectionReason: reason,
        livenessScore: decision.livenessScore ?? null,
        faceMatchScore: decision.faceMatchScore ?? null,
        providerRef: decision.providerRef,
        documentHash,
        documentType: decision.documentType ?? null,
        documentLast4: decision.documentNumber
          ? decision.documentNumber.slice(-4)
          : null,
        decidedAt: new Date(),
      },
    });
    if (count === 0) return;

    await tx.user.updateMany({
      where: {
        id: row.userId,
        // A late Declined for an old attempt must never un-verify someone.
        ...(status === 'VERIFIED' ? {} : { kycStatus: { not: 'VERIFIED' } }),
      },
      data: {
        kycStatus: status,
        ...(status === 'VERIFIED' ? { kycVerifiedAt: new Date() } : {}),
      },
    });
  });

  logger.info({ verificationId: row.id, status }, 'KYC decision applied');
}

/**
 * Asks the provider directly when a decision is overdue.
 *
 * Needed in two situations: a webhook that never arrived, and local development,
 * where the provider cannot reach localhost so no webhook is ever sent. The two
 * thresholds do different jobs — RECONCILE_AFTER_MS gives the webhook a chance to
 * win the race, RECONCILE_INTERVAL_MS stops a polling UI from billing us on every
 * render.
 */
async function reconcile(row: KycVerification): Promise<void> {
  if (row.status !== 'PENDING' || !row.providerRef) return;
  if (row.pollCount >= MAX_POLLS) return;

  const now = Date.now();
  if (now - row.submittedAt.getTime() < RECONCILE_AFTER_MS) return;
  if (row.lastPolledAt && now - row.lastPolledAt.getTime() < RECONCILE_INTERVAL_MS) return;

  await prisma.kycVerification.update({
    where: { id: row.id },
    data: { lastPolledAt: new Date(), pollCount: { increment: 1 } },
  });

  const decision = await kycProvider.getVerification(row.providerRef);
  if (decision) await applyDecision({ ...decision, reference: row.id });
}

export async function getStatus(userId: string): Promise<KycStatusView> {
  const latest = await prisma.kycVerification.findFirst({
    where: { userId },
    orderBy: { submittedAt: 'desc' },
  });

  if (latest) await reconcile(latest);

  const [user, fresh, attempts] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { kycStatus: true } }),
    latest
      ? prisma.kycVerification.findUnique({ where: { id: latest.id } })
      : Promise.resolve(null),
    prisma.kycVerification.count({ where: { userId, status: { not: 'EXPIRED' } } }),
  ]);

  return view(user.kycStatus, fresh, attempts);
}

export async function submit(userId: string): Promise<KycStatusView> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { kycStatus: true, firstName: true, lastName: true, email: true },
  });

  // Already through, or already awaiting a decision: never start a second session.
  if (user.kycStatus === 'VERIFIED' || user.kycStatus === 'PENDING') {
    return getStatus(userId);
  }

  // No duplicate check here any more: nothing identifies the document until the
  // provider reads it. The check now lives in applyDecision.
  const [dayCount, lifetimeCount] = await Promise.all([
    prisma.kycVerification.count({
      where: {
        userId,
        status: { not: 'EXPIRED' },
        submittedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.kycVerification.count({ where: { userId, status: { not: 'EXPIRED' } } }),
  ]);

  if (dayCount >= MAX_ATTEMPTS_PER_DAY || lifetimeCount >= MAX_ATTEMPTS_LIFETIME) {
    throw tooManyRequests(
      'You have reached the identity verification attempt limit. Contact support.',
    );
  }

  // The row is created BEFORE the provider call because its id is the correlation
  // key we hand over as vendor_data — it is what lets a webhook find its way back
  // to this attempt. Written with the User update, the rule Wallet.balanceFils
  // follows against LedgerEntry: a status with no attempt behind it is unauditable.
  const attempt = await prisma.$transaction(async (tx) => {
    const created = await tx.kycVerification.create({
      data: { userId, provider: kycProvider.name, status: 'PENDING' },
    });
    await tx.user.update({ where: { id: userId }, data: { kycStatus: 'PENDING' } });
    return created;
  });

  let result;
  try {
    result = await kycProvider.startVerification({
      reference: attempt.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      returnUrl: `${env.WEB_ORIGIN}/verify-identity`,
    });
  } catch (err) {
    // EXPIRED, not REJECTED: the provider being unreachable is our problem, not a
    // failed identity check, and it must not consume one of the user's attempts.
    logger.error({ err, verificationId: attempt.id }, 'Failed to start KYC session');
    await prisma.$transaction([
      prisma.kycVerification.update({
        where: { id: attempt.id },
        data: { status: 'EXPIRED', decidedAt: new Date() },
      }),
      prisma.user.update({ where: { id: userId }, data: { kycStatus: 'EXPIRED' } }),
    ]);
    return getStatus(userId);
  }

  await prisma.kycVerification.update({
    where: { id: attempt.id },
    data: {
      providerRef: result.providerRef,
      redirectUrl: result.redirectUrl,
      expiresAt: result.expiresAt ?? null,
    },
  });

  // A driver with no hosted step (the stub) decides immediately, and supplies the
  // document itself so the duplicate check still runs.
  if (result.status !== 'PENDING') {
    await applyDecision({
      reference: attempt.id,
      providerRef: result.providerRef ?? attempt.id,
      status: result.status,
      rejectionReason: result.rejectionReason,
      documentNumber: result.documentNumber,
      documentType: result.documentType,
    });
  }

  logger.info(
    { userId, provider: kycProvider.name, status: result.status },
    'KYC attempt started',
  );

  return getStatus(userId);
}
