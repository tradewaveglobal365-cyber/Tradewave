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
        // Surfaced above everything because a held deposit is the only row that
        // needs a person: someone's money has arrived and is sitting uncredited.
        <div className="mb-5 rounded-xl border border-pending/40 bg-pending/5 px-4 py-3">
          <p className="text-[0.8125rem] font-medium text-foreground">
            {held.length} deposit{held.length === 1 ? '' : 's'} held
          </p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">
            These arrived with no rate published, so nothing was credited. Publish a rate,
            then release them.
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
        <>
          {/* Cards below md. A six-column table on a phone is either unreadable
              or a horizontal scroll nobody discovers, so the same data is laid
              out vertically instead of squeezed. */}
          <ul className="space-y-3 md:hidden">
            {deposits.map((d) => (
              <DepositCard key={d.id} deposit={d} />
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border border-hairline bg-surface md:block">
            <table className="w-full text-left">
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
                  <DepositRow key={d.id} deposit={d} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function DepositCard({ deposit: d }: { deposit: AdminDeposit }) {
  const held = d.status === 'PENDING';

  return (
    <li className="rounded-xl border border-hairline bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.875rem] font-medium text-foreground">
            {d.user.firstName} {d.user.lastName}
          </p>
          <p className="mt-0.5 truncate text-[0.75rem] text-muted-foreground">
            {d.user.email}
          </p>
        </div>
        <StatusPill status={d.status} />
      </div>

      <dl className="mt-3 space-y-1.5 border-t border-hairline pt-3 text-[0.8125rem]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Received</dt>
          <dd className="tabular-nums text-foreground">
            {d.sourceAmountMinor ? formatNgn(d.sourceAmountMinor) : '—'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Credited</dt>
          <dd className="font-medium tabular-nums text-foreground">
            {held ? <span className="font-normal text-muted-foreground">—</span> : formatUsd(d.amountCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Rate</dt>
          <dd className="tabular-nums text-muted-foreground">
            {d.rateMinorPerUnit ? `${formatNgn(d.rateMinorPerUnit)}/$` : '—'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Date</dt>
          <dd className="text-muted-foreground">{formatDate(d)}</dd>
        </div>
      </dl>

      {held ? (
        <div className="mt-3 border-t border-hairline pt-3">
          <RetryDepositButton depositId={d.id} full />
        </div>
      ) : null}
    </li>
  );
}

function DepositRow({ deposit: d }: { deposit: AdminDeposit }) {
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
        <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{formatDate(d)}</p>
      </td>
      <td className="px-4 py-3">{held ? <RetryDepositButton depositId={d.id} /> : null}</td>
    </tr>
  );
}

function formatDate(d: AdminDeposit): string {
  return new Date(d.paidAt ?? d.createdAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function StatusPill({ status }: { status: AdminDeposit['status'] }) {
  const tone =
    status === 'SUCCESS'
      ? 'bg-gain/10 text-gain'
      : status === 'PENDING'
        ? 'bg-pending/15 text-pending'
        : 'bg-muted text-muted-foreground';

  const label =
    status === 'PENDING' ? 'Held' : status.charAt(0) + status.slice(1).toLowerCase();

  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}
