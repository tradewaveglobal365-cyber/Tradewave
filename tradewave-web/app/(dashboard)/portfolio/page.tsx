import type { Metadata } from 'next';
import Link from 'next/link';
import { PieChart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';
import { getPortfolio } from '@/lib/investments';
import { formatAed } from '@/lib/money';
import { HoldingCard } from '@/components/dashboard/holding-card';

export const metadata: Metadata = { title: 'Portfolio · Tradewave' };

export default async function PortfolioPage() {
  const portfolio = await getPortfolio();
  const hasHoldings = (portfolio?.holdingCount ?? 0) > 0;

  return (
    <div>
      <PageHeader
        title="Portfolio"
        description="Every investment you hold, with its accrued value and maturity date."
      />

      {hasHoldings && portfolio ? (
        <>
          <section className="mb-6 grid gap-4 sm:grid-cols-3">
            <Tile label="Holdings" value={String(portfolio.holdingCount)} />
            <Tile label="Total invested" value={formatAed(portfolio.totalInvestedCents)} />
            <Tile label="Returns accrued" value={`+${formatAed(portfolio.accruedCents)}`} tone="gain" />
          </section>

          <div className="space-y-3">
            {portfolio.holdings.map((h) => (
              <HoldingCard key={h.id} holding={h} />
            ))}
          </div>

          <p className="mt-6 text-center text-[0.75rem] leading-relaxed text-muted-foreground">
            Accrued values are calculated daily from each holding&rsquo;s declared rate and stop at
            maturity. Returns are not guaranteed.
          </p>
        </>
      ) : (
        <EmptyState
          icon={<PieChart className="size-5" />}
          title="You don't hold any investments yet"
          description="Once you invest in a property it appears here, with its accrued value updating daily until maturity."
          action={
            <Button asChild className="h-11 md:h-10">
              <Link href="/properties">Browse properties</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'gain' }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-5">
      <p className="text-[0.75rem] font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1.5 text-[1.375rem] leading-none font-semibold tabular-nums ${
          tone === 'gain' ? 'text-gain' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
