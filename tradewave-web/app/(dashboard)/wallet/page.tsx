import type { Metadata } from 'next';
import { Plus, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';
import { getWallet } from '@/lib/wallet';
import { formatAed, formatUsd, PEGGED_FILS_PER_USD } from '@/lib/money';

export const metadata: Metadata = { title: 'Wallet · Tradewave' };

export default async function WalletPage() {
  const wallet = await getWallet();
  const balanceFils = wallet?.balanceFils ?? '0';

  return (
    <div>
      <PageHeader
        title="Wallet"
        description="Fund your wallet, then invest from your balance."
      />

      <section className="rounded-xl border border-hairline bg-surface p-6">
        <p className="text-[0.8125rem] font-medium text-muted-foreground">Available balance</p>
        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[2rem] leading-none font-semibold tracking-[-0.02em] tabular-nums text-foreground">
              {formatAed(balanceFils)}
            </p>
            {/* AED is pegged to USD at 3.6725, so this is exact rather than
                indicative — but it is still labelled, because a bare dollar
                figure reads as a promise to redeem in dollars. */}
            <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
              {formatUsd(balanceFils, PEGGED_FILS_PER_USD)} at the AED/USD peg
            </p>
          </div>
          <Button disabled className="h-11 gap-1.5 md:h-10">
            <Plus className="size-4" />
            Fund wallet
          </Button>
        </div>
        <p className="mt-4 rounded-lg border border-dashed border-hairline bg-canvas px-3.5 py-3 text-[0.75rem] leading-relaxed text-muted-foreground">
          Funding is disabled until the payment provider is confirmed. Nothing here can move
          money yet.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-[1rem] font-semibold text-foreground">Transactions</h2>
        <EmptyState
          icon={<Receipt className="size-5" />}
          title="No transactions yet"
          description="Deposits, investments and returns will all appear here as a running ledger."
        />
      </section>
    </div>
  );
}
