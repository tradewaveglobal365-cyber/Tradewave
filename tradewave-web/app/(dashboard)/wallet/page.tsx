import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle, Receipt, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';
import { AddFundsPanel } from '@/components/wallet/add-funds-panel';
import { getDepositAccount, getWallet } from '@/lib/wallet';
import { getCurrentUser } from '@/lib/session';
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
  // The user is read here so the funding panel can be decided from the identity
  // status itself rather than inferred from a failed request. Fetched alongside
  // the wallet so an unverified user still gets their balance rather than a
  // blank page.
  const [user, wallet, deposit] = await Promise.all([
    getCurrentUser(),
    getWallet(),
    getDepositAccount(),
  ]);
  const balanceCents = wallet?.balanceCents ?? '0';
  const entries = wallet?.entries ?? [];

  // kycStatus is the authority on this, not the deposit-account read. A
  // verified investor must never be told to verify because Klasha timed out.
  const verified = user?.kycStatus === 'VERIFIED';

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
          {deposit.state === 'ok' ? (
            <AddFundsPanel account={deposit.account} />
          ) : !verified ? (
            <Panel
              icon={<ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
              title="Verify your identity to add funds"
              body="We issue your naira account once your identity is confirmed. It takes about a minute — photograph an ID and take a selfie."
            >
              <Button asChild className="mt-3 h-11 md:h-10">
                <Link href="/verify-identity">Verify identity</Link>
              </Button>
            </Panel>
          ) : (
            // Verified, but we could not issue the account. Say that, rather
            // than sending them back through a check they have already passed.
            <Panel
              tone="warn"
              icon={<AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
              title="Funding is unavailable right now"
              body={
                deposit.state === 'unavailable'
                  ? deposit.message
                  : 'Please try again shortly.'
              }
            >
              <p className="mt-2 text-[0.75rem] text-muted-foreground">
                Your identity is verified — there is nothing for you to do. This is on
                our side and your account number will appear here once it is fixed.
              </p>
            </Panel>
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

/** The non-funding states of the balance card, so both read as deliberate. */
function Panel({
  icon,
  title,
  body,
  tone = 'quiet',
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone?: 'quiet' | 'warn';
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-dashed px-4 py-4 ${
        tone === 'warn'
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-hairline bg-canvas'
      }`}
    >
      <div className="flex items-start gap-3">
        {icon}
        <div>
          <p className="text-[0.8125rem] font-medium text-foreground">{title}</p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-muted-foreground">{body}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
