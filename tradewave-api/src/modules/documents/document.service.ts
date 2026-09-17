import { prisma } from '../../lib/prisma';
import { notFound, badRequest } from '../../lib/errors';
import { computeAccrual } from '../investment/accrual';
import { renderCertificate } from '../../services/documents/certificate';
import { renderStatement, type StatementEntry } from '../../services/documents/statement';

/**
 * Records an investor can keep.
 *
 * Both documents are generated on demand rather than stored, and that is safe
 * for a specific reason in each case:
 *
 *   A certificate reads from Investment, which snapshots the rate and term at
 *   purchase — so it says the same thing today and in two years, whatever
 *   happens to the listing.
 *
 *   A statement reads from LedgerEntry, which is append-only and records the
 *   balance on every row — so a period cannot be restated later.
 *
 * Storing signed copies would add a bucket, a lifecycle and a second source of
 * truth, and buy nothing that immutable inputs do not already give.
 */

export interface DocumentListItem {
  kind: 'CERTIFICATE';
  id: string;
  title: string;
  subtitle: string;
  /** What the document itself is about, not when it was generated. */
  date: Date;
  href: string;
}

export async function listDocuments(userId: string): Promise<DocumentListItem[]> {
  const investments = await prisma.investment.findMany({
    where: { userId, status: { in: ['ACTIVE', 'MATURED'] } },
    orderBy: { investedAt: 'desc' },
    include: { property: { select: { title: true, area: true } } },
  });

  return investments.map((i) => ({
    kind: 'CERTIFICATE' as const,
    id: i.id,
    title: i.property.title,
    subtitle: `${i.property.area} · ${i.status === 'MATURED' ? 'Matured' : 'Active'}`,
    date: i.investedAt,
    href: `/documents/certificate/${i.id}`,
  }));
}

export async function buildCertificate(userId: string, investmentId: string): Promise<Buffer> {
  const investment = await prisma.investment.findUnique({
    where: { id: investmentId },
    include: {
      property: { select: { title: true, area: true, city: true } },
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  // Not-found rather than forbidden for somebody else's investment: a 403 would
  // confirm the id exists, which is not something a stranger needs to learn.
  if (!investment || investment.userId !== userId) {
    throw notFound('That investment does not exist.');
  }

  const accrual = computeAccrual(
    {
      principalCents: investment.principalCents,
      annualReturnBps: investment.annualReturnBps,
      investedAt: investment.investedAt,
      maturesAt: investment.maturesAt,
    },
    investment.maturesAt,
  );

  return renderCertificate({
    investmentId: investment.id,
    investorName: `${investment.user.firstName} ${investment.user.lastName}`,
    investorEmail: investment.user.email,
    propertyTitle: investment.property.title,
    propertyArea: investment.property.area,
    propertyCity: investment.property.city,
    principalCents: investment.principalCents,
    projectedTotalCents: accrual.projectedTotalCents,
    annualReturnBps: investment.annualReturnBps,
    termMonths: investment.termMonths,
    investedAt: investment.investedAt,
    maturesAt: investment.maturesAt,
    status: investment.status,
  });
}

/** A statement may not span more than this. Bounded so one request cannot ask
 *  for a document with a hundred thousand rows in it. */
const MAX_PERIOD_DAYS = 400;

export async function buildStatement(
  userId: string,
  from: Date,
  to: Date,
): Promise<Buffer> {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw badRequest('Give a valid date range.');
  }
  if (to < from) throw badRequest('The end of the period is before the start.');
  if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_PERIOD_DAYS) {
    throw badRequest(`A statement can cover at most ${MAX_PERIOD_DAYS} days.`);
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });

  const wallet = await prisma.wallet.findUnique({ where: { userId }, select: { id: true } });

  // No wallet is a real answer — somebody who has never funded an account still
  // gets a statement, it just says nothing moved.
  const entries = wallet
    ? await prisma.ledgerEntry.findMany({
        where: { walletId: wallet.id, createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'asc' },
        select: {
          createdAt: true,
          type: true,
          description: true,
          amountCents: true,
          balanceAfterCents: true,
        },
      })
    : [];

  // Read off the ledger rather than re-adding the column. The entry immediately
  // before the period already records what the balance was at that moment, so
  // the opening figure cannot drift from the wallet the way a recomputed one
  // could.
  const previous = wallet
    ? await prisma.ledgerEntry.findFirst({
        where: { walletId: wallet.id, createdAt: { lt: from } },
        orderBy: { createdAt: 'desc' },
        select: { balanceAfterCents: true },
      })
    : null;

  const openingCents = previous?.balanceAfterCents ?? 0n;
  const closingCents = entries.at(-1)?.balanceAfterCents ?? openingCents;

  return renderStatement({
    investorName: `${user.firstName} ${user.lastName}`,
    investorEmail: user.email,
    from,
    to,
    openingCents,
    closingCents,
    entries: entries as StatementEntry[],
  });
}
