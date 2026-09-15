import type { Metadata } from 'next';
import { AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/page-header';
import { FxRateForm } from '@/components/admin/fx-rate-form';
import { getFxRate } from '@/lib/admin';
import { formatNgn } from '@/lib/money';
import { ADMIN_NAV_ITEMS } from '@/lib/admin-nav';

export const metadata: Metadata = { title: 'FX rate · Admin' };

export default async function FxRatePage() {
  const rate = await getFxRate();
  const current = rate?.minorPerUnit ?? null;
  const description = ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/fx-rate')?.description;

  return (
    <div>
      <PageHeader title="FX rate" description={description} />

      {current ? (
        <section className="rounded-xl border border-hairline bg-surface p-6">
          <p className="text-[0.8125rem] font-medium text-muted-foreground">Current rate</p>
          <p className="mt-1.5 text-[2rem] leading-none font-semibold tracking-[-0.02em] tabular-nums text-foreground">
            {formatNgn(current)}
            <span className="ml-2 text-[1rem] font-normal text-muted-foreground">
              per $1.00
            </span>
          </p>
          {rate?.effectiveAt ? (
            <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
              Published{' '}
              {new Date(rate.effectiveAt).toLocaleString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          ) : null}
        </section>
      ) : (
        // Not a neutral empty state. With no rate, deposits are closed: a user
        // sees their account number but no quote, and anything they send is held
        // rather than credited. Say so.
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="text-[0.875rem] font-medium text-destructive">
                No rate published — deposits are closed
              </p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
                Investors can see their naira account number, but no quote. Anything they
                transfer is recorded and held, not credited, until a rate exists. Publish
                one below and any held deposit can then be released from the Deposits tab.
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="mt-6 rounded-xl border border-hairline bg-surface p-6">
        <h2 className="text-[1rem] font-semibold text-foreground">
          {current ? 'Update the rate' : 'Publish a rate'}
        </h2>
        <p className="mt-1 mb-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
          Each change is recorded as a new entry rather than overwriting the last, so a
          deposit credited yesterday can always be explained. Deposits already credited
          keep the rate they were quoted at.
        </p>
        <FxRateForm currentMinorPerUnit={current} />
      </section>
    </div>
  );
}
