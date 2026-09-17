import type { Prisma, AdminActionType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

/**
 * What staff did to whom, and why.
 *
 * Append-only. Nothing here updates or deletes a row, and nothing should: this
 * is the only thing in the codebase that can answer "who froze this person, and
 * why" months later, and a record that can be edited answers nothing.
 *
 * Three actor columns existed before this — Withdrawal.decidedByUserId,
 * WithdrawalWindow.updatedByUserId, FxRate.setByUserId — and each keeps only the
 * LAST actor for one row. An approve-then-mark-paid by two different people
 * remembers only the second.
 */

export interface RecordActionInput {
  type: AdminActionType;
  actorId: string;
  /** Null for platform-wide actions, which have no single subject. */
  subjectId?: string | null;
  reason: string;
  detail?: Prisma.InputJsonValue | undefined;
}

/**
 * Records an action, and never throws.
 *
 * Follows recordAttempt's precedent in auth.service: an audit write must not be
 * able to break the thing it describes. A suspension that fails because the log
 * failed is worse than a suspension nobody logged.
 *
 * The ONE exception is a balance adjustment, which calls recordActionTx below
 * inside its own transaction — money created with no record of who created it
 * is the single case where losing the audit is worse than losing the action.
 */
export async function recordAction(input: RecordActionInput): Promise<void> {
  try {
    await prisma.adminAction.create({
      data: {
        type: input.type,
        actorId: input.actorId,
        subjectId: input.subjectId ?? null,
        reason: input.reason,
        ...(input.detail === undefined ? {} : { detail: input.detail }),
      },
    });
  } catch (err) {
    logger.error({ err, type: input.type }, 'Failed to record an admin action');
  }
}

/** The same write, inside a caller's transaction, where it MUST succeed. */
export async function recordActionTx(
  tx: Prisma.TransactionClient,
  input: RecordActionInput,
): Promise<void> {
  await tx.adminAction.create({
    data: {
      type: input.type,
      actorId: input.actorId,
      subjectId: input.subjectId ?? null,
      reason: input.reason,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
    },
  });
}

export interface AdminActionView {
  id: string;
  type: string;
  reason: string;
  detail: unknown;
  createdAt: Date;
  /** Who did it. Null only if the staff account was deleted. */
  actor: { id: string; firstName: string; lastName: string; email: string } | null;
}

/** How much history an investor's page carries. */
const ACTION_LIMIT = 50;

export async function listActionsForSubject(subjectId: string): Promise<AdminActionView[]> {
  const rows = await prisma.adminAction.findMany({
    where: { subjectId },
    orderBy: { createdAt: 'desc' },
    take: ACTION_LIMIT,
    include: {
      actor: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    reason: r.reason,
    detail: r.detail,
    createdAt: r.createdAt,
    actor: r.actor,
  }));
}
