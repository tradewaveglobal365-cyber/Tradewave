import type { KycStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { hashIdentifier } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { documentAlreadyVerified, tooManyRequests } from '../../lib/errors';
import { kycProvider } from '../../services/kyc';
import type { SubmitKycInput } from './schemas';

/**
 * Attempt caps live here rather than in the express limiter because that limiter
 * is memory-backed (resets on deploy, not shared across replicas) and is skipped
 * entirely under test — see middleware/rate-limit.ts:15. Every provider check
 * costs real money, so the ceiling that actually protects the budget has to be
 * one the database enforces and the tests can exercise.
 */
const MAX_ATTEMPTS_PER_DAY = 3;
const MAX_ATTEMPTS_LIFETIME = 10;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface KycStatusView {
  status: KycStatus;
  documentLast4: string | null;
  reason: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  canRetry: boolean;
  attemptsRemaining: number;
}

/** EXPIRED never counts — a provider timeout is not the user's failed attempt. */
function countable(status: KycStatus): boolean {
  return status !== 'EXPIRED';
}

export async function getStatus(userId: string): Promise<KycStatusView> {
  const [user, latest, attempts] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { kycStatus: true },
    }),
    prisma.kycVerification.findFirst({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
    }),
    prisma.kycVerification.count({
      where: { userId, status: { not: 'EXPIRED' } },
    }),
  ]);

  const remaining = Math.max(0, MAX_ATTEMPTS_LIFETIME - attempts);

  return {
    status: user.kycStatus,
    documentLast4: latest?.documentLast4 ?? null,
    reason: latest?.rejectionReason ?? null,
    submittedAt: latest?.submittedAt ?? null,
    decidedAt: latest?.decidedAt ?? null,
    canRetry:
      remaining > 0 &&
      (user.kycStatus === 'NOT_STARTED' ||
        user.kycStatus === 'REJECTED' ||
        user.kycStatus === 'EXPIRED'),
    attemptsRemaining: remaining,
  };
}

export async function submit(
  userId: string,
  input: SubmitKycInput,
): Promise<KycStatusView> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { kycStatus: true, firstName: true, lastName: true },
  });

  // Already through, or already awaiting a decision: never spend a second check.
  if (user.kycStatus === 'VERIFIED' || user.kycStatus === 'PENDING') {
    return getStatus(userId);
  }

  const documentHash = hashIdentifier(input.documentNumber);

  // Cheap local checks before anything that costs money.
  const [claimedByOther, dayCount, lifetimeCount] = await Promise.all([
    prisma.kycVerification.findFirst({
      where: { documentHash, status: 'VERIFIED', userId: { not: userId } },
      select: { id: true },
    }),
    prisma.kycVerification.count({
      where: {
        userId,
        status: { not: 'EXPIRED' },
        submittedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.kycVerification.count({
      where: { userId, status: { not: 'EXPIRED' } },
    }),
  ]);

  if (claimedByOther) {
    // Deliberately does not say whose account — that would leak membership.
    throw documentAlreadyVerified();
  }
  if (dayCount >= MAX_ATTEMPTS_PER_DAY || lifetimeCount >= MAX_ATTEMPTS_LIFETIME) {
    throw tooManyRequests(
      'You have reached the identity verification attempt limit. Contact support.',
    );
  }

  const result = await kycProvider.startVerification({
    userId,
    documentType: input.documentType,
    documentNumber: input.documentNumber,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  const decided = result.status !== 'PENDING';

  // The User row and the attempt that justifies it are written together, the same
  // rule Wallet.balanceFils follows against LedgerEntry: a status with no attempt
  // behind it is unauditable.
  await prisma.$transaction([
    prisma.kycVerification.create({
      data: {
        userId,
        provider: kycProvider.name,
        providerRef: result.providerRef,
        documentType: input.documentType,
        documentLast4: input.documentNumber.slice(-4),
        documentHash,
        status: result.status,
        rejectionReason: result.rejectionReason ?? null,
        decidedAt: decided ? new Date() : null,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: result.status,
        ...(result.status === 'VERIFIED' ? { kycVerifiedAt: new Date() } : {}),
      },
    }),
  ]);

  logger.info(
    { userId, provider: kycProvider.name, status: result.status },
    'KYC attempt recorded',
  );

  return getStatus(userId);
}
