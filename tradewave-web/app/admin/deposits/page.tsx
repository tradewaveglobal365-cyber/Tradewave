import type { Metadata } from 'next';
import { Banknote } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';
import { RetryDepositButton } from '@/components/admin/retry-deposit-button';
import { getAdminDeposits, type AdminDeposit } from '@/lib/admin';
import { ADMIN_NAV_ITEMS } from '@/lib/admin-nav';
import { formatNgn, formatUsd } from '@/lib/money';

export const metadata: Metadata = { title: 'Deposits · Admin' };

export default async function DepositsPage() {
  const deposits = await getAdminDeposits();
  const held = deposits.filter((d) => d.status === 'PENDING');
  const description = ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/deposits')?.description;

  return (
    <div>
      <PageHeader title="Deposits" description={description} />

      {held.length > 0 ? (
        // Surfaced above the table because a held deposit is the only row that
        // needs a person: someone's money has arrived and is sitting uncredited.
        <div className="mb-5 rounded-xl border border-pending/40 bg-pending/5 px-4 py-3">
          <p className="text-[0.8125rem] font-medium text-foreground">
            {held.length} deposit{held.length === 1 ? '' : 's'} held
          </p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">
            These arrived with no rate published, so nothing was credited. Publish a rate,
            then release them below.
          </p>
        </div>
      ) : null}

      {deposits.length === 0 ? (
        <EmptyState
          icon={<Banknote className="size-5" />}
          title="No deposits yet"
          description="Naira transfers into investor accounts will appear here as they land."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline bg-surface">
          <table className="w-full min-w-[46rem] text-left">
            <thead>
              <tr className="border-b border-hairline text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-2.5">Investor</th>
                <th className="px-4 py-2.5 text-right">Received</th>
                <th className="px-4 py-2.5 text-right">Credited</th>
                <th className="px-4 py-2.5 text-right">Rate</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => (
                <Row key={d.id} deposit={d} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ deposit: d }: { deposit: AdminDeposit }) {
  const held = d.status === 'PENDING';

  return (
    <tr className="border-b border-hairline last:border-b-0">
      <td className="px-4 py-3">
        <p className="text-[0.8125rem] font-medium text-foreground">
          {d.user.firstName} {d.user.lastName}
        </p>
        <p className="mt-0.5 truncate text-[0.75rem] text-muted-foreground">{d.user.email}</p>
      </td>
      <td className="px-4 py-3 text-right text-[0.8125rem] tabular-nums text-foreground">
        {d.sourceAmountMinor ? formatNgn(d.sourceAmountMinor) : '—'}
      </td>
      <td className="px-4 py-3 text-right text-[0.8125rem] tabular-nums">
        {held ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="font-medium text-foreground">{formatUsd(d.amountCents)}</span>
        )}
      </td>
      <td className="px-4 py-3 text-right text-[0.75rem] tabular-nums text-muted-foreground">
        {d.rateMinorPerUnit ? `${formatNgn(d.rateMinorPerUnit)}/$` : '—'}
      </td>
      <td className="px-4 py-3">
        <StatusPill status={d.status} />
        <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
          {new Date(d.paidAt ?? d.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </p>
      </td>
      <td className="px-4 py-3">
        {held ? <RetryDepositButton depositId={d.id} /> : null}
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: AdminDeposit['status'] }) {
  const tone =
    status === 'SUCCESS'
      ? 'bg-gain/10 text-gain'
      : status === 'PENDING'
        ? 'bg-pending/15 text-pending'
        : 'bg-muted text-muted-foreground';

  const label = status === 'PENDING' ? 'Held' : status.charAt(0) + status.slice(1).toLowerCase();

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}
