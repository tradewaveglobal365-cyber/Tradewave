import type { Metadata } from 'next';
import { ArrowUpRight, ShieldAlert } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';
import { WithdrawalActions } from '@/components/admin/withdrawal-actions';
import { WithdrawalWindowForm } from '@/components/admin/withdrawal-window-form';
import {
  getAdminWithdrawals,
  getWithdrawalWindow,
  type AdminWithdrawal,
} from '@/lib/admin';
import { ADMIN_NAV_ITEMS } from '@/lib/admin-nav';
import { formatNgn, formatUsd } from '@/lib/money';

export const metadata: Metadata = { title: 'Withdrawals · Admin' };

/** Past this, somebody is waiting on us rather than on a bank. */
const STALE_HOURS = 24;

export default async function WithdrawalsPage() {
  // Each is its own round trip; neither depends on the other.
  const [withdrawals, schedule] = await Promise.all([
    getAdminWithdrawals(),
    getWithdrawalWindow(),
  ]);
  const description = ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/withdrawals')?.description;

  const waiting = withdrawals.filter((w) => w.status === 'REQUESTED');
  const stale = waiting.filter((w) => w.waitingHours >= STALE_HOURS);
  const flagged = waiting.filter((w) => w.destinationChangedRecently);

  return (
    <div>
      <PageHeader title="Withdrawals" description={description} />

      {schedule ? (
        <WithdrawalWindowForm window={schedule.window} state={schedule.state} />
      ) : null}

      {waiting.length > 0 ? (
        <div className="mb-5 rounded-xl border border-pending/40 bg-pending/5 px-4 py-3">
          <p className="text-[0.8125rem] font-medium text-foreground">
            {waiting.length} withdrawal{waiting.length === 1 ? '' : 's'} waiting
            {stale.length > 0 ? ` · ${stale.length} over ${STALE_HOURS} hours` : ''}
          </p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">
            The money has already left each investor&rsquo;s balance. Until one of these is
            approved or rejected, somebody is waiting on us rather than on their bank.
          </p>
        </div>
      ) : null}

      {flagged.length > 0 ? (
        // The reason a person is in this loop at all. Everything else on this
        // screen could be automated; noticing that the destination moved days
        // before the withdrawal is the part that cannot be.
        <div className="mb-5 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-foreground">
            <ShieldAlert className="size-3.5 text-destructive" />
            {flagged.length} to look at twice
          </p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">
            The payout account was changed within the last week. That is the shape of a taken
            over account — check the name matches before releasing the money.
          </p>
        </div>
      ) : null}

      {withdrawals.length === 0 ? (
        <EmptyState
          icon={<ArrowUpRight className="size-5" />}
          title="No withdrawals yet"
          description="Requests to send money out will appear here, newest first."
        />
      ) : (
        <>
          {/* Cards below md — an eight-column table on a phone is either
              unreadable or a horizontal scroll nobody discovers. */}
          <ul className="space-y-3 md:hidden">
            {withdrawals.map((w) => (
              <WithdrawalCard key={w.id} withdrawal={w} />
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border border-hairline bg-surface md:block">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-hairline text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
                  <th className="px-4 py-2.5">Investor</th>
                  <th className="px-4 py-2.5">Destination</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-right">Sending</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => (
                  <WithdrawalRow key={w.id} withdrawal={w} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function WithdrawalRow({ withdrawal: w }: { withdrawal: AdminWithdrawal }) {
  return (
    <tr className="border-b border-hairline last:border-b-0 hover:bg-canvas/60">
      <td className="px-4 py-3">
        <p className="text-[0.8125rem] font-medium text-foreground">
          {w.user.firstName} {w.user.lastName}
        </p>
        <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{w.user.email}</p>
      </td>
      <td className="px-4 py-3">
        <p className="flex items-center gap-1.5 text-[0.8125rem] text-foreground">
          {w.bankName}
          {w.destinationChangedRecently ? (
            <ShieldAlert className="size-3.5 shrink-0 text-destructive" />
          ) : null}
        </p>
        <p className="mt-0.5 font-mono text-[0.75rem] text-muted-foreground tabular-nums">
          {w.accountNumberMasked}
        </p>
        <p className="mt-0.5 truncate text-[0.75rem] text-muted-foreground">{w.accountName}</p>
      </td>
      <td className="px-4 py-3 text-right">
        <p className="text-[0.8125rem] font-medium text-foreground tabular-nums">
          {formatUsd(w.amountCents)}
        </p>
        <p className="mt-0.5 text-[0.75rem] text-muted-foreground tabular-nums">
          less {formatUsd(w.feeCents)} fee
        </p>
      </td>
      <td className="px-4 py-3 text-right text-[0.8125rem] text-foreground tabular-nums">
        {w.destinationAmountMinor ? formatNgn(w.destinationAmountMinor) : '—'}
      </td>
      <td className="px-4 py-3">
        <StatusPill withdrawal={w} />
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">{age(w)}</p>
      </td>
      <td className="px-4 py-3">
        <WithdrawalActions withdrawalId={w.id} status={w.status} />
      </td>
    </tr>
  );
}

function WithdrawalCard({ withdrawal: w }: { withdrawal: AdminWithdrawal }) {
  return (
    <li className="rounded-xl border border-hairline bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.875rem] font-medium text-foreground">
            {w.user.firstName} {w.user.lastName}
          </p>
          <p className="mt-0.5 truncate text-[0.75rem] text-muted-foreground">{w.user.email}</p>
        </div>
        <StatusPill withdrawal={w} />
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline pt-3">
        <Stat label="Amount" value={formatUsd(w.amountCents)} />
        <Stat label="Fee" value={formatUsd(w.feeCents)} />
        <Stat
          label="Sending"
          value={w.destinationAmountMinor ? formatNgn(w.destinationAmountMinor) : '—'}
        />
        <Stat label="Waiting" value={age(w)} />
      </dl>

      <div className="mt-3 border-t border-hairline pt-3">
        <p className="flex items-center gap-1.5 text-[0.8125rem] text-foreground">
          {w.bankName}
          {w.destinationChangedRecently ? (
            <ShieldAlert className="size-3.5 shrink-0 text-destructive" />
          ) : null}
        </p>
        <p className="mt-0.5 font-mono text-[0.75rem] text-muted-foreground tabular-nums">
          {w.accountNumberMasked} · {w.accountName}
        </p>
      </div>

      {w.failureReason || w.rejectionReason ? (
        <p className="mt-2 text-[0.75rem] leading-relaxed text-muted-foreground">
          {w.failureReason ?? w.rejectionReason}
        </p>
      ) : null}

      <div className="mt-3">
        <WithdrawalActions withdrawalId={w.id} status={w.status} full />
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[0.8125rem] font-medium text-foreground tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/** How long it has been waiting, or when it settled. */
function age(w: AdminWithdrawal): string {
  if (w.status !== 'REQUESTED' && w.status !== 'APPROVED') {
    return new Date(w.decidedAt ?? w.requestedAt).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    });
  }
  if (w.waitingHours < 1) return 'just now';
  if (w.waitingHours < 24) return `${w.waitingHours}h`;
  return `${Math.floor(w.waitingHours / 24)}d`;
}

function StatusPill({ withdrawal: w }: { withdrawal: AdminWithdrawal }) {
  const tone =
    w.status === 'PAID'
      ? 'bg-gain/10 text-gain'
      : w.status === 'REQUESTED' || w.status === 'APPROVED'
        ? 'bg-pending/15 text-pending'
        : w.status === 'FAILED' || w.status === 'REJECTED'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-muted text-muted-foreground';

  // APPROVED reads as a decision taken; what it means operationally is that the
  // money is with the provider and nobody has confirmed it landed yet.
  const label =
    w.status === 'APPROVED'
      ? 'Sending'
      : w.status === 'REQUESTED'
        ? 'Waiting'
        : w.status.charAt(0) + w.status.slice(1).toLowerCase();

  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}
