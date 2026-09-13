import { prisma } from '../../lib/prisma';

export interface WalletView {
  balanceCents: bigint;
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
    },
  });

  return {
    balanceCents: wallet.balanceCents,
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
