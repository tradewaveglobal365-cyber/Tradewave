import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { creditFromReference } from '../wallet/deposit.service';

/**
 * Operational reads for the admin area.
 *
 * Deliberately thin. Everything that changes money already has a service — this
 * module calls into those rather than reimplementing them, so an admin action
 * and a webhook cannot drift into behaving differently.
 */

/** Recent deposits only. At current volumes this is a list, not a paged table. */
const DEPOSIT_LIMIT = 100;

export interface AdminDepositView {
  id: string;
  status: string;
  providerRef: string;
  /** Naira actually received, in kobo. Null on rows created before this existed. */
  sourceAmountMinor: string | null;
  sourceCurrency: string;
  /** Dollars credited. Zero while a deposit is held for want of a rate. */
  amountCents: string;
  /** The rate applied, pinned at receipt. Null means nothing was credited yet. */
  rateMinorPerUnit: string | null;
  paidAt: Date | null;
  createdAt: Date;
  user: { id: string; email: string; firstName: string; lastName: string };
}

export async function listDeposits(): Promise<AdminDepositView[]> {
  const rows = await prisma.deposit.findMany({
    orderBy: { createdAt: 'desc' },
    take: DEPOSIT_LIMIT,
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });

  return rows.map((d) => ({
    id: d.id,
    status: d.status,
    providerRef: d.providerRef,
    sourceAmountMinor: d.sourceAmountMinor?.toString() ?? null,
    sourceCurrency: d.sourceCurrency,
    amountCents: d.amountCents.toString(),
    rateMinorPerUnit: d.rateMinorPerUnit?.toString() ?? null,
    paidAt: d.paidAt,
    createdAt: d.createdAt,
    user: d.user,
  }));
}

/**
 * Re-runs the credit for one deposit.
 *
 * The case this exists for: money arrived before any USD/NGN rate was published,
 * so it was recorded PENDING rather than dropped. The sweep normally completes
 * such a deposit once a rate exists — but the sweep only sees the provider's most
 * recent transactions, so one that has scrolled off that window is stranded.
 *
 * Safe to call on an already-credited deposit: creditFromReference goes through
 * applyPayment, where the unique constraint on the ledger entry's reference makes
 * a second credit impossible.
 */
export async function retryDeposit(depositId: string): Promise<AdminDepositView> {
  const deposit = await prisma.deposit.findUnique({
    where: { id: depositId },
    select: { providerRef: true },
  });
  if (!deposit) throw notFound('Deposit not found.');

  await creditFromReference(deposit.providerRef);

  const fresh = await prisma.deposit.findUniqueOrThrow({
    where: { id: depositId },
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });

  return {
    id: fresh.id,
    status: fresh.status,
    providerRef: fresh.providerRef,
    sourceAmountMinor: fresh.sourceAmountMinor?.toString() ?? null,
    sourceCurrency: fresh.sourceCurrency,
    amountCents: fresh.amountCents.toString(),
    rateMinorPerUnit: fresh.rateMinorPerUnit?.toString() ?? null,
    paidAt: fresh.paidAt,
    createdAt: fresh.createdAt,
    user: fresh.user,
  };
}
