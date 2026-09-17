import { ShieldCheck } from 'lucide-react';
import { TRUST_BAR } from '@/content/home';
import { formatBps } from '@/lib/money';
import type { MarketingStats } from '@/lib/public-properties';
import { Reveal } from './reveal';

/**
 * Thin credibility strip between the hero and the first real section.
 *
 * Two of the three figures are invented placeholders. They render normally in
 * production, but carry a visible marker in development so the team cannot
 * forget them — see `content/home.ts`, where each is flagged `placeholder`.
 */
export function TrustBar({ stats }: { stats: MarketingStats | null }) {

  return (
    <section className="border-b border-hairline bg-surface">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <Reveal className="flex flex-col items-center gap-7 lg:flex-row lg:justify-between">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <span className="text-[0.75rem] font-medium tracking-[0.1em] uppercase text-muted-foreground">
              Registered with
            </span>
            {TRUST_BAR.regulators.map((regulator) => (
              <span
                key={regulator.short}
                title={regulator.label}
                className="inline-flex items-center gap-2 text-[0.9375rem] font-semibold text-brand-800"
              >
                <ShieldCheck className="size-4 text-brand-500" strokeWidth={2} />
                {regulator.short}
              </span>
            ))}
          </div>

          {/* Derived from real listings, and absent when there are none. The
              two figures that used to sit here — capital deployed, investors
              onboarded — were invented, and there is no honest way to show a
              traction number we do not have. */}
          {stats ? (
            <dl className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
              {[
                { label: stats.count === 1 ? 'Property listed' : 'Properties listed', value: String(stats.count) },
                { label: 'Average annual yield', value: formatBps(stats.avgYieldBps) },
              ].map((stat) => (
                // Value above label, so the flex order flips the dt/dd pair.
                <div key={stat.label} className="flex flex-col text-center lg:text-right">
                  <dt className="order-2 text-[0.75rem] text-muted-foreground">{stat.label}</dt>
                  <dd className="order-1 text-[1.375rem] leading-tight font-semibold tabular-nums text-foreground">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Reveal>
      </div>
    </section>
  );
}
