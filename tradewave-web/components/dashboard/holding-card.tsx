import Link from 'next/link';
import type { Holding } from '@/lib/investments';
import { formatAed, formatBps } from '@/lib/money';

export function HoldingCard({ holding }: { holding: Holding }) {
  const pct = Math.round(holding.progress * 100);
  const matures = new Date(holding.maturesAt).toLocaleDateString('en-AE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <Link
      href={`/properties/${holding.property.slug}`}
      className="flex gap-4 rounded-xl border border-hairline bg-surface p-4 transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {holding.property.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={holding.property.image}
          alt=""
          className="hidden size-20 shrink-0 rounded-lg object-cover sm:block"
          loading="lazy"
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem] font-semibold text-foreground">
              {holding.property.title}
            </p>
            <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
              {holding.property.area} &middot; {formatBps(holding.annualReturnBps)}/yr
            </p>
          </div>
          <div className="text-right">
            <p className="text-[0.9375rem] font-semibold tabular-nums text-foreground">
              {formatAed(holding.currentValueFils)}
            </p>
            {/* gain, never brand green — this is a number going up. */}
            <p className="text-[0.75rem] font-medium tabular-nums text-gain">
              +{formatAed(holding.accruedFils)}
            </p>
          </div>
        </div>

        <div className="mt-3">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${pct} percent through its term`}
          >
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">
            {holding.isMatured ? 'Matured' : `${pct}% of term · matures ${matures}`}
          </p>
        </div>
      </div>
    </Link>
  );
}
