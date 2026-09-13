import type { Holding } from '@/lib/investments';
import { centsToNumber } from '@/lib/money';

/**
 * Returns accrued over time.
 *
 * Deliberately plots ACCRUED RETURNS, not total portfolio value. Total value
 * steps upward every time capital is added, and a deposit is not growth — on a
 * young portfolio that step dominates the y-axis and hides the actual returns
 * entirely. Accrued returns start at zero and only ever rise, so the line shows
 * the thing the user came to see.
 *
 * A hand-drawn inline SVG rather than a chart library: the series comes from a
 * closed-form function and is a single monotonic line, so Recharts would be
 * ~50KB of bundle for a polyline.
 *
 * Mirrors the server's simple-interest rule. Display only — the authoritative
 * figures come from GET /portfolio.
 */
function accruedAtCents(holding: Holding, at: number): number {
  const principal = centsToNumber(holding.principalCents);
  const start = new Date(holding.investedAt).getTime();
  const end = new Date(holding.maturesAt).getTime();
  if (at <= start) return 0; // not yet held — accrues nothing

  const effective = Math.min(at, end);
  const elapsedDays = Math.floor((effective - start) / 86_400_000);
  return Math.floor((principal * holding.annualReturnBps * elapsedDays) / (10_000 * 365));
}

const POINTS = 32;

export function GrowthCurve({ holdings }: { holdings: Holding[] }) {
  if (holdings.length === 0) return null;

  const start = Math.min(...holdings.map((h) => new Date(h.investedAt).getTime()));
  const end = Date.now();
  if (end <= start) return null;

  const series = Array.from({ length: POINTS }, (_, i) => {
    const at = start + ((end - start) * i) / (POINTS - 1);
    return holdings.reduce((sum, h) => sum + accruedAtCents(h, at), 0);
  });

  // Anchored at zero, not at the series minimum: accrual starts from nothing,
  // and rebasing the axis would exaggerate a small gain into a dramatic climb.
  const max = Math.max(...series, 1);
  const min = 0;
  const range = max - min || 1;

  const W = 100;
  const H = 34;
  const points = series.map((v, i) => {
    const x = (i / (POINTS - 1)) * W;
    // Floor at 2 so the line never sits flush on the baseline and disappear.
    const y = H - 2 - ((v - min) / range) * (H - 6);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-20 w-full"
      role="img"
      aria-label="Returns accrued since your first investment"
    >
      <defs>
        <linearGradient id="tw-growth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-gain)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-gain)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${points.join(' ')} ${W},${H}`} fill="url(#tw-growth)" />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="var(--color-gain)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
