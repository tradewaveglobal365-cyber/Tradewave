import { ShieldCheck } from 'lucide-react';
import { TRUST_BAR } from '@/content/home';
import { Reveal } from './reveal';

/**
 * Thin credibility strip between the hero and the first real section.
 *
 * Two of the three figures are invented placeholders. They render normally in
 * production, but carry a visible marker in development so the team cannot
 * forget them — see `content/home.ts`, where each is flagged `placeholder`.
 */
export function TrustBar() {
  const isDev = process.env.NODE_ENV === 'development';

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

          <dl className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {TRUST_BAR.stats.map((stat) => (
              // Value above label, so the flex order flips the dt/dd pair.
              <div key={stat.label} className="flex flex-col text-center lg:text-right">
                <dt className="order-2 text-[0.75rem] text-muted-foreground">
                  {stat.label}
                  {isDev && stat.placeholder ? (
                    <span className="ml-1.5 rounded bg-pending/15 px-1 py-0.5 text-[0.625rem] font-semibold text-pending">
                      TODO
                    </span>
                  ) : null}
                </dt>
                <dd className="order-1 text-[1.375rem] leading-tight font-semibold tabular-nums text-foreground">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
