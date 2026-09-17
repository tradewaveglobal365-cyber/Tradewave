import { prisma } from '../../lib/prisma';
import { PAYOUT_ACCOUNT_HOLD_MS } from '../wallet/withdrawal.service';

/**
 * The withdrawal queue, as staff need to see it.
 *
 * Read-only. Everything that moves money lives in wallet/withdrawal.service and
 * is called from the routes — the same rule admin.service states for deposits,
 * so that an admin action and a webhook cannot drift into behaving differently.
 *
 * The account number is masked here as it is everywhere else. Reading a full
 * one off a screen is not part of approving a payout, and it is the single
 * field an attacker would want.
 */

/** Recent withdrawals. At current volumes this is a list, not a paged table. */
const WITHDRAWAL_LIMIT = 100;

/** How recently the destination changed before it is worth a second look. */
const RECENT_CHANGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface AdminWithdrawalView {
  id: string;
  status: string;
  amountCents: string;
  feeCents: string;
  netCents: string;
  bankName: string;
  bankCode: string;
  accountNumberMasked: string;
  accountName: string;
  destinationAmountMinor: string | null;
  rateMinorPerUnit: string | null;
  provider: string;
  providerRef: string | null;
  failureReason: string | null;
  rejectionReason: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
  paidAt: Date | null;
  /** Whole hours since it was asked for, so the UI does no date arithmetic. */
  waitingHours: number;
  /**
   * The destination was changed within the last week.
   *
   * The reason a person is in this loop at all. A withdrawal to an account that
   * moved days ago is the shape of a taken-over account, and it is the one
   * thing on this screen that cannot be checked automatically.
   */
  destinationChangedRecently: boolean;
  /** Whether the bank ever confirmed the name, or the user merely asserted it. */
  nameResolved: boolean;
  user: { id: string; email: string; firstName: string; lastName: string };
}

export async function listWithdrawals(): Promise<AdminWithdrawalView[]> {
  const rows = await prisma.withdrawal.findMany({
    orderBy: { requestedAt: 'desc' },
    take: WITHDRAWAL_LIMIT,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          payoutAccount: { select: { destinationChangedAt: true, nameResolved: true } },
        },
      },
    },
  });

  const now = Date.now();

  return rows.map((w) => {
    const account = w.user.payoutAccount;
    return {
      id: w.id,
      status: w.status,
      amountCents: w.amountCents.toString(),
      feeCents: w.feeCents.toString(),
      netCents: (w.amountCents - w.feeCents).toString(),
      bankName: w.bankName,
      bankCode: w.bankCode,
      accountNumberMasked: `••••${w.accountNumber.slice(-4)}`,
      accountName: w.accountName,
      destinationAmountMinor: w.destinationAmountMinor?.toString() ?? null,
      rateMinorPerUnit: w.rateMinorPerUnit?.toString() ?? null,
      provider: w.provider,
      providerRef: w.providerRef,
      failureReason: w.failureReason,
      rejectionReason: w.rejectionReason,
      requestedAt: w.requestedAt,
      decidedAt: w.decidedAt,
      paidAt: w.paidAt,
      waitingHours: Math.floor((now - w.requestedAt.getTime()) / (60 * 60 * 1000)),
      destinationChangedRecently: account
        ? now - account.destinationChangedAt.getTime() < RECENT_CHANGE_MS
        : false,
      nameResolved: account?.nameResolved ?? false,
      user: {
        id: w.user.id,
        email: w.user.email,
        firstName: w.user.firstName,
        lastName: w.user.lastName,
      },
    };
  });
}

/** Re-exported so the admin routes do not reach into the wallet module twice. */
export { PAYOUT_ACCOUNT_HOLD_MS };
