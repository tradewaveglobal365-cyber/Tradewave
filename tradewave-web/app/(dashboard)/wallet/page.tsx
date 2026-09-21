import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle, ArrowUpRight, Clock, Lock, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';
import { AddFundsPanel } from '@/components/wallet/add-funds-panel';
import { getDepositAccount, getWallet, getWithdrawalContext } from '@/lib/wallet';
import { formatAed, formatNgn, formatUsd } from '@/lib/money';

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
  // The user used to be read here so the funding panel could be decided from
  // kycStatus rather than inferred from a failed request. Identity no longer
  // decides anything on this screen, and the locked figure comes off the wallet
  // itself, so there is nothing left for it to answer.
  const [wallet, deposit, withdrawals] = await Promise.all([
    getWallet(),
    getDepositAccount(),
    getWithdrawalContext(),
  ]);
  const balanceCents = wallet?.balanceCents ?? '0';
  const lockedCents = wallet?.lockedCents ?? '0';
  const availableCents = wallet?.availableCents ?? '0';
  const entries = wallet?.entries ?? [];

  // Referral earnings this investor has been paid but cannot spend yet. The
  // API decides this — it is the same figure the debit guard enforces, and two
  // derivations of it would eventually disagree.
  const hasLocked = lockedCents !== '0';
  const live = withdrawals?.live ?? null;

  return (
    <div>
      <PageHeader
        title="Wallet"
        description="Fund your wallet in naira, then invest from your dollar balance."
      />

      <section className="rounded-xl border border-hairline bg-surface p-6">
        <p className="text-[0.8125rem] font-medium text-muted-foreground">
          {hasLocked ? 'Total balance' : 'Available balance'}
        </p>
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

        {/* Shown only when there IS something held, so the ordinary wallet is
            not cluttered by a permanent line reading "$0.00 locked". The figure
            is named as theirs and the reason is stated in the same breath —
            money you cannot see the reason for reads as money taken. */}
        {hasLocked ? (
          <div className="mt-4 rounded-lg border border-hairline bg-muted/40 p-3.5">
            <div className="flex items-start gap-2.5">
              <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-[0.8125rem] font-medium text-foreground">
                  {formatUsd(availableCents)} available &middot; {formatUsd(lockedCents)} locked
                </p>
                <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                  Your referral earnings are yours, and they unlock the moment your
                  identity is verified. Everything you have deposited can be invested
                  or withdrawn as normal.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-2.5 h-9">
                  <Link href="/verify-identity">Verify and unlock</Link>
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-5">
          {deposit.state === 'ok' ? (
            <AddFundsPanel account={deposit.account} />
          ) : (
            // Identity is no longer a reason to be here: the account is issued
            // to anyone. So every remaining case is OUR problem, and the panel
            // says so rather than handing the investor a task they cannot do.
            <Panel
              tone="warn"
              icon={<AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
              title="Funding is unavailable right now"
              body={deposit.message}
            >
              <p className="mt-2 text-[0.75rem] text-muted-foreground">
                There is nothing for you to do. Your account number will appear here
                once this is fixed.
              </p>
            </Panel>
          )}
        </div>

        {/* Taking money out lives on its own screen rather than expanding
            here: it is a form with a confirmation step, and the funding panel
            above already owns this card. A link keeps both reachable without
            either one burying the other. */}
        {withdrawals ? (
          <div className="mt-4 border-t border-hairline pt-4">
            <Button asChild variant="outline" className="h-10 gap-1.5">
              <Link href="/wallet/withdraw">
                <ArrowUpRight className="size-3.5" />
                Withdraw
              </Link>
            </Button>
          </div>
        ) : null}
      </section>

      {/* One in flight is the thing somebody opens this page to check on, so it
          sits above the ledger rather than inside it — the ledger row for it
          says only that money left, not where it has got to. */}
      {live ? (
        <section className="mt-6 rounded-xl border border-pending/40 bg-pending/5 px-4 py-3.5">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 size-4 shrink-0 text-pending" />
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-medium text-foreground">
                {formatUsd(live.amountCents)} withdrawal{' '}
                {live.status === 'REQUESTED' ? 'waiting to be reviewed' : 'on its way'}
              </p>
              <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">
                To {live.bankName} {live.accountNumberMasked}
                {live.destinationAmountMinor
                  ? ` · sending ${formatNgn(live.destinationAmountMinor)}`
                  : ''}
              </p>
            </div>
            <Link
              href="/wallet/withdraw"
              className="shrink-0 text-[0.75rem] font-medium text-brand-700 transition-colors hover:text-brand-900"
            >
              Details
            </Link>
          </div>
        </section>
      ) : null}

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
