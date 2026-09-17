import type { Metadata } from 'next';
import { CalendarClock, AlertTriangle } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';
import { SettleMaturityButton } from '@/components/admin/settle-maturity-button';
import { getAdminMaturities, type AdminMaturity } from '@/lib/admin';
import { ADMIN_NAV_ITEMS } from '@/lib/admin-nav';
import { formatUsd } from '@/lib/money';

export const metadata: Metadata = { title: 'Maturities · Admin' };

/**
 * What is coming due.
 *
 * Settlement runs off page loads rather than a scheduled job, and loading this
 * page runs it. The screen exists so a quiet week is visible: without it,
 * "nobody has logged in for four days" and "settlement is broken" look
 * identical from the outside.
 */
export default async function MaturitiesPage() {
  const maturities = await getAdminMaturities();
  const description = ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/maturities')?.description;

  const overdue = maturities.filter((m) => m.daysUntil < 0);
  const totalDue = maturities.reduce((sum, m) => sum + Number(m.payoutCents), 0);

  return (
    <div>
      <PageHeader title="Maturities" description={description} />

      {overdue.length > 0 ? (
        // Anything here has already passed its term and has not been settled by
        // the sweep, which means nobody has loaded a page that triggers it.
        <div className="mb-5 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-foreground">
            <AlertTriangle className="size-3.5 text-destructive" />
            {overdue.length} overdue
          </p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">
            These passed their maturity date and have not been paid out. Opening this page
            settles anything due — if they are still here after a refresh, settle them by hand
            and say so.
          </p>
        </div>
      ) : null}

      {maturities.length > 0 ? (
        <div className="mb-5 rounded-xl border border-hairline bg-surface px-4 py-3">
          <p className="text-[0.8125rem] font-medium text-foreground">
            {formatUsd(String(totalDue))} due within 30 days
          </p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">
            Across {maturities.length} investment{maturities.length === 1 ? '' : 's'}. This is
            money the platform owes and will credit automatically.
          </p>
        </div>
      ) : null}

      {maturities.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-5" />}
          title="Nothing due in the next 30 days"
          description="Investments reaching the end of their term will appear here, soonest first."
        />
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {maturities.map((m) => (
              <MaturityCard key={m.investmentId} maturity={m} />
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border border-hairline bg-surface md:block">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-hairline text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
                  <th className="px-4 py-2.5">Investor</th>
                  <th className="px-4 py-2.5">Property</th>
                  <th className="px-4 py-2.5 text-right">Principal</th>
                  <th className="px-4 py-2.5 text-right">Payout</th>
                  <th className="px-4 py-2.5">Matures</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {maturities.map((m) => (
                  <MaturityRow key={m.investmentId} maturity={m} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function MaturityRow({ maturity: m }: { maturity: AdminMaturity }) {
  return (
    <tr className="border-b border-hairline last:border-b-0 hover:bg-canvas/60">
      <td className="px-4 py-3">
        <p className="text-[0.8125rem] font-medium text-foreground">
          {m.user.firstName} {m.user.lastName}
        </p>
        <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{m.user.email}</p>
      </td>
      <td className="px-4 py-3 text-[0.8125rem] text-foreground">{m.propertyTitle}</td>
      <td className="px-4 py-3 text-right text-[0.8125rem] text-muted-foreground tabular-nums">
        {formatUsd(m.principalCents)}
      </td>
      <td className="px-4 py-3 text-right text-[0.8125rem] font-medium text-foreground tabular-nums">
        {formatUsd(m.payoutCents)}
      </td>
      <td className="px-4 py-3">
        <DueLabel maturity={m} />
      </td>
      <td className="px-4 py-3 text-right">
        {m.daysUntil < 0 ? <SettleMaturityButton investmentId={m.investmentId} /> : null}
      </td>
    </tr>
  );
}

function MaturityCard({ maturity: m }: { maturity: AdminMaturity }) {
  return (
    <li className="rounded-xl border border-hairline bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.875rem] font-medium text-foreground">
            {m.user.firstName} {m.user.lastName}
          </p>
          <p className="mt-0.5 truncate text-[0.75rem] text-muted-foreground">
            {m.propertyTitle}
          </p>
        </div>
        <DueLabel maturity={m} />
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline pt-3">
        <div>
          <dt className="text-[0.6875rem] text-muted-foreground">Principal</dt>
          <dd className="mt-0.5 text-[0.8125rem] text-foreground tabular-nums">
            {formatUsd(m.principalCents)}
          </dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] text-muted-foreground">Payout</dt>
          <dd className="mt-0.5 text-[0.8125rem] font-medium text-foreground tabular-nums">
            {formatUsd(m.payoutCents)}
          </dd>
        </div>
      </dl>

      {m.daysUntil < 0 ? (
        <div className="mt-3">
          <SettleMaturityButton investmentId={m.investmentId} full />
        </div>
      ) : null}
    </li>
  );
}

function DueLabel({ maturity: m }: { maturity: AdminMaturity }) {
  const date = new Date(m.maturesAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  if (m.daysUntil < 0) {
    return (
      <div>
        <span className="inline-flex shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[0.6875rem] font-medium text-destructive">
          {Math.abs(m.daysUntil)}d overdue
        </span>
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">{date}</p>
      </div>
    );
  }

  return (
    <div>
      <span className="inline-flex shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
        {m.daysUntil === 0 ? 'today' : `in ${m.daysUntil}d`}
      </span>
      <p className="mt-1 text-[0.6875rem] text-muted-foreground">{date}</p>
    </div>
  );
}
