import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowUpRight, Building2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/session';
import { getWallet } from '@/lib/wallet';
import { getPortfolio } from '@/lib/investments';
import { formatAed } from '@/lib/money';
import { PageHeader, EmptyState } from '@/components/dashboard/page-header';
import { SetupChecklist } from '@/components/dashboard/setup-checklist';
import { GrowthCurve } from '@/components/dashboard/growth-curve';
import { HoldingCard } from '@/components/dashboard/holding-card';

export const metadata: Metadata = { title: 'Overview · Tradewave' };

export default async function DashboardPage() {
  const [user, wallet, portfolio] = await Promise.all([
    getCurrentUser(),
    getWallet(),
    getPortfolio(),
  ]);
  if (!user) redirect('/login?next=/dashboard');

  const balanceFils = wallet?.balanceFils ?? '0';
  const hasHoldings = (portfolio?.holdingCount ?? 0) > 0;

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user.firstName}`}
        description={
          hasHoldings
            ? 'Your holdings and how they are tracking.'
            : 'Get set up, then put your first capital to work.'
        }
      />

      <SetupChecklist user={user} hasBalance={Number(balanceFils) > 0} />

      {hasHoldings && portfolio ? (
        <>
          <section className="rounded-xl border border-hairline bg-surface p-6">
            <div className="grid gap-6 sm:grid-cols-3">
              <Stat label="Total invested" value={formatAed(portfolio.totalInvestedFils)} />
              <Stat label="Current value" value={formatAed(portfolio.currentValueFils)} strong />
              <Stat
                label="Returns accrued"
                value={`+${formatAed(portfolio.accruedFils)}`}
                tone="gain"
              />
            </div>
            <div className="mt-5 border-t border-hairline pt-4">
              <GrowthCurve holdings={portfolio.holdings} />
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                Returns accrued since your first investment
              </p>
            </div>
          </section>

          <section className="mt-6">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[1rem] font-semibold text-foreground">Your holdings</h2>
              <Link
                href="/portfolio"
                className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-brand-700 underline-offset-4 hover:underline"
              >
                View all
                <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
            <div className="space-y-3">
              {portfolio.holdings.slice(0, 3).map((h) => (
                <HoldingCard key={h.id} holding={h} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <EmptyState
          icon={<TrendingUp className="size-5" />}
          title="You haven't invested yet"
          description="Browse vetted Dubai property and buy a fraction of one. Your holdings and returns will show up here."
          action={
            <Button asChild className="h-11 gap-1.5 md:h-10">
              <Link href="/properties">
                <Building2 className="size-4" />
                Browse properties
              </Link>
            </Button>
          }
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: 'gain';
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-[0.75rem] font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1.5 leading-none font-semibold tabular-nums ${
          tone === 'gain' ? 'text-gain' : 'text-foreground'
        } ${strong ? 'text-[1.75rem]' : 'text-[1.375rem]'}`}
      >
        {value}
      </p>
    </div>
  );
}
