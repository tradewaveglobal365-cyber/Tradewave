import type { Metadata } from 'next';
import Link from 'next/link';
import { Receipt, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';
import { AddFundsPanel } from '@/components/wallet/add-funds-panel';
import { getDepositAccount, getWallet } from '@/lib/wallet';
import { formatAed, formatUsd } from '@/lib/money';

export const metadata: Metadata = { title: 'Wallet · Tradewave' };

/** Ledger rows the API may send. Labelled here so the UI never shows an enum. */
const ENTRY_LABELS: Record<string, string> = {
  DEPOSIT: 'Wallet funding',
  INVESTMENT: 'Investment',
  RETURN_PAYOUT: 'Return payout',
  REFERRAL_BONUS: 'Referral bonus',
  WITHDRAWAL: 'Withdrawal',
  ADJUSTMENT: 'Adjustment',
};

export default async function WalletPage() {
  // A null account means the API answered 403 — identity not verified yet —
  // which is a state to render, not an error. Fetched alongside the wallet so
  // an unverified user still gets their balance rather than a blank page.
  const [wallet, account] = await Promise.all([getWallet(), getDepositAccount()]);
  const balanceCents = wallet?.balanceCents ?? '0';
  const entries = wallet?.entries ?? [];

  return (
    <div>
      <PageHeader
        title="Wallet"
        description="Fund your wallet in naira, then invest from your dollar balance."
      />

      <section className="rounded-xl border border-hairline bg-surface p-6">
        <p className="text-[0.8125rem] font-medium text-muted-foreground">Available balance</p>
        <p className="mt-1.5 text-[2rem] leading-none font-semibold tracking-[-0.02em] tabular-nums text-foreground">
          {formatUsd(balanceCents)}
        </p>
        {/* The balance is held in dollars; the dirham figure is what the same
            money buys in Dubai. Exact rather than indicative, because the
            dirham is pegged at 3.6725 — but still labelled, so it does not
            read as a second balance. */}
        <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
          {formatAed(balanceCents)} at the AED/USD peg
        </p>

        <div className="mt-5">
          {account ? (
            <AddFundsPanel account={account} />
          ) : (
            <div className="rounded-lg border border-dashed border-hairline bg-canvas px-4 py-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-[0.8125rem] font-medium text-foreground">
                    Verify your identity to add funds
                  </p>
                  <p className="mt-1 text-[0.75rem] leading-relaxed text-muted-foreground">
                    We issue your naira account once your identity is confirmed. It takes
                    about a minute — photograph an ID and take a selfie.
                  </p>
                  <Button asChild className="mt-3 h-9">
                    <Link href="/verify-identity">Verify identity</Link>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-[1rem] font-semibold text-foreground">Transactions</h2>
        {entries.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-5" />}
            title="No transactions yet"
            description="Deposits, investments and returns will all appear here as a running ledger."
          />
        ) : (
          <ul className="overflow-hidden rounded-xl border border-hairline bg-surface">
            {entries.map((entry) => {
              const credit = !entry.amountCents.startsWith('-');
              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.8125rem] font-medium text-foreground">
                      {entry.description || ENTRY_LABELS[entry.type] || entry.type}
                    </p>
                    <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-[0.8125rem] font-medium tabular-nums ${
                        credit ? 'text-gain' : 'text-foreground'
                      }`}
                    >
                      {credit ? '+' : '−'}
                      {formatUsd(entry.amountCents.replace('-', ''))}
                    </p>
                    <p className="mt-0.5 text-[0.75rem] text-muted-foreground tabular-nums">
                      {formatUsd(entry.balanceAfterCents)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
