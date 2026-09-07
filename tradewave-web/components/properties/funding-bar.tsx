import type { Property } from '@/lib/types';
import { formatAedCompact } from '@/lib/money';

export function FundingBar({ property }: { property: Property }) {
  const pct = Math.round(property.fundedProgress * 100);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[0.75rem]">
        <span className="font-medium text-foreground">{pct}% funded</span>
        <span className="text-muted-foreground">
          {formatAedCompact(property.remainingFils)} left
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct} percent funded`}
      >
        {/* A sliver is shown at 0% only if there is genuinely some funding, so
            an empty bar never looks like a rendering failure. */}
        <div
          className="h-full rounded-full bg-gain transition-[width] duration-500"
          style={{ width: `${pct === 0 ? 0 : Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  );
}
