import { Repeat, Shuffle, SlidersHorizontal } from 'lucide-react';
import { AUTO_INVEST } from '@/content/home';
import { Section, SectionHeader } from './section';
import { Reveal } from './reveal';

const ICONS = [SlidersHorizontal, Shuffle, Repeat] as const;

/**
 * The "autonomous real estate trading" section.
 *
 * ⚠️  There is no auto-invest endpoint in tradewave-api. Everything here is
 * future tense and the section leads with an "In development" badge and closes
 * with an explicit disclaimer. Do not rewrite this copy into the present tense
 * until the feature actually ships.
 */
export function AutoInvest() {
  return (
    <Section id="auto-invest" tone="dark">
      <div className="grid gap-14 lg:grid-cols-[1fr_0.85fr] lg:items-center lg:gap-20">
        <div>
          <SectionHeader
            eyebrow={AUTO_INVEST.eyebrow}
            heading={AUTO_INVEST.heading}
            description={AUTO_INVEST.description}
            tone="dark"
          />

          <ul className="mt-11 space-y-7">
            {AUTO_INVEST.steps.map((step, index) => {
              const Icon = ICONS[index] ?? SlidersHorizontal;
              return (
                <Reveal as="li" key={step.title} delay={index * 80} className="flex gap-4">
                  <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5">
                    <Icon className="size-4 text-brand-200" strokeWidth={2} />
                  </span>
                  <div>
                    <h3 className="text-[0.9375rem] font-semibold text-white">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-brand-200">
                      {step.body}
                    </p>
                  </div>
                </Reveal>
              );
            })}
          </ul>

          <Reveal delay={260}>
            <p className="mt-10 border-t border-white/10 pt-6 text-[0.8125rem] leading-relaxed text-brand-300">
              {AUTO_INVEST.note}
            </p>
          </Reveal>
        </div>

        <Reveal delay={140}>
          <CompoundingChart />
        </Reveal>
      </div>
    </Section>
  );
}

/**
 * Principal carried forward, cycle over cycle.
 *
 * Bar heights are illustrative proportions, not a projection — there are
 * deliberately no figures attached, because a specific number here would be a
 * forecast for a product that does not exist yet.
 */
function CompoundingChart() {
  /*
    Percentages of the 11rem track, so the tallest bar tops out just under it.
    They must stay percentages of a STRETCHED column: the row below uses the
    default `items-stretch` rather than `items-end` precisely so each column
    inherits the track height. With `items-end` the columns size to their
    content, a percentage height then resolves against `auto`, and every bar
    collapses to nothing.
  */
  const CYCLES = [
    { principal: 50, growth: 7.5 },
    { principal: 57.5, growth: 10 },
    { principal: 67.5, growth: 12.5 },
    { principal: 80, growth: 15 },
  ];

  return (
    <figure className="rounded-2xl border border-white/12 bg-white/5 p-7 backdrop-blur-sm">
      <figcaption className="text-[0.8125rem] font-semibold text-white">
        Returns rolled forward
      </figcaption>
      <p className="mt-1 text-[0.75rem] text-brand-300">
        Each term&rsquo;s return becomes principal in the next.
      </p>

      <div className="mt-8 flex h-44 gap-3" aria-hidden="true">
        {CYCLES.map((cycle, index) => (
          <div key={index} className="flex flex-1 flex-col justify-end gap-1">
            <span
              className="w-full shrink-0 rounded-t-md bg-brand-300"
              style={{ height: `${cycle.growth}%` }}
            />
            <span
              className="w-full shrink-0 rounded-b-md bg-white/12"
              style={{ height: `${cycle.principal}%` }}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-3" aria-hidden="true">
        {CYCLES.map((_, index) => (
          <span
            key={index}
            className="flex-1 text-center text-[0.6875rem] text-brand-300"
          >
            Term {index + 1}
          </span>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-5">
        <span className="flex items-center gap-2 text-[0.75rem] text-brand-200">
          <span className="size-2.5 rounded-[3px] bg-brand-300" />
          Return reinvested
        </span>
        <span className="flex items-center gap-2 text-[0.75rem] text-brand-200">
          <span className="size-2.5 rounded-[3px] bg-white/12" />
          Principal
        </span>
      </div>
    </figure>
  );
}
