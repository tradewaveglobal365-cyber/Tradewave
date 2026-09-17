'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Holding } from '@/lib/investments';
import { formatBps, formatUsd } from '@/lib/money';
import { centsToUsd, formatCountdown, liveAccrual } from '@/lib/accrual';

/**
 * A holding, counting up.
 *
 * ── Why this costs the server nothing ─────────────────────────────────────
 * Accrual is a pure function of four values the page already has: principal,
 * rate, start and maturity. So the browser recomputes it locally every second
 * with no network call at all. There is no polling, no socket, and the server
 * never learns the number is moving.
 *
 * ── Why it uses the server's clock, not the device's ──────────────────────
 * A phone with a wrong clock would otherwise show earnings we would not pay.
 * The portfolio read returns the server's time; we measure the offset once on
 * mount and work from that forever after, so the display tracks our clock even
 * on a device that is minutes out.
 *
 * ── What actually ticks ───────────────────────────────────────────────────
 * The countdown moves every second. The money figure moves whenever its cent
 * value genuinely changes, which at these rates is roughly once a minute — it
 * is not smoothed or animated ahead of itself, because a number that runs
 * ahead of what would be paid is the one thing this component must never do.
 */
export function LiveHoldingCard({
  holding,
  serverTime,
}: {
  holding: Holding;
  /** ISO timestamp from the API response, for the clock offset. */
  serverTime: string | null;
}) {
  // Measured once, in a ref rather than state: it must not trigger a render,
  // and it must not be recomputed on every tick.
  const offsetRef = useRef<number | null>(null);
  if (offsetRef.current === null) {
    offsetRef.current = serverTime ? new Date(serverTime).getTime() - Date.now() : 0;
  }

  const input = {
    principalCents: holding.principalCents,
    annualReturnBps: holding.annualReturnBps,
    investedAt: holding.investedAt,
    maturesAt: holding.maturesAt,
  };

  // Seeded from the server's own numbers so the first paint matches what was
  // rendered on the server — no flash of a different figure on hydration.
  const [now, setNow] = useState(() => Date.now() + (offsetRef.current ?? 0));

  useEffect(() => {
    // Stop ticking once it has matured. Nothing changes after that, and a timer
    // running forever in a background tab is rude.
    if (new Date(holding.maturesAt).getTime() <= Date.now() + (offsetRef.current ?? 0)) return;

    const id = setInterval(() => setNow(Date.now() + (offsetRef.current ?? 0)), 1000);
    return () => clearInterval(id);
  }, [holding.maturesAt]);

  const live = liveAccrual(input, now);
  const pct = live.progress * 100;

  const maturesOn = new Date(holding.maturesAt).toLocaleDateString('en-GB', {
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
              {centsToUsd(live.currentValueCents)}
            </p>
            {/* gain, never brand green — this is a number going up. */}
            <p className="text-[0.75rem] font-medium tabular-nums text-gain">
              +{centsToUsd(live.accruedCents)}
            </p>
          </div>
        </div>

        <div className="mt-3">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${Math.round(pct)} percent through its term`}
          >
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-1000 ease-linear"
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>

          {live.isMatured ? (
            <p className="mt-1.5 text-[0.6875rem] font-medium text-gain">
              Matured &middot; paid into your wallet
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-[0.6875rem] text-muted-foreground">
                {pct.toFixed(1)}% of term &middot; matures {maturesOn}
              </p>
              {/* aria-live is deliberately off: a countdown announcing itself
                  every second would make a screen reader unusable. The exact
                  maturity date is in the line above, which is the part that
                  actually matters to someone not watching it move. */}
              <p
                className="text-[0.6875rem] font-medium text-foreground tabular-nums"
                aria-hidden="true"
              >
                {formatCountdown(live.msRemaining)}
              </p>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

/** The server-rendered figure, for anything that should not tick. */
export function staticHoldingValue(holding: Holding): string {
  return formatUsd(holding.currentValueCents);
}
