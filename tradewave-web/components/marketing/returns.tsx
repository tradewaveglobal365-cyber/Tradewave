import { RETURNS, formatBps } from '@/content/home';
import { Section, SectionHeader } from './section';
import { Reveal } from './reveal';
import { ReturnsCalculator } from './returns-calculator';

export function Returns() {
  return (
    <Section id="returns" tone="canvas">
      <div className="grid gap-12 lg:grid-cols-[0.9fr_1fr] lg:items-start lg:gap-16">
        <div>
          <SectionHeader
            eyebrow={RETURNS.eyebrow}
            heading={RETURNS.heading}
            description={RETURNS.description}
          />

          <ul className="mt-10 space-y-px overflow-hidden rounded-xl border border-hairline bg-hairline">
            {RETURNS.bands.map((band, index) => (
              <Reveal
                as="li"
                key={band.label}
                delay={index * 70}
                className="flex items-center justify-between gap-4 bg-surface px-5 py-4"
              >
                <div>
                  <p className="text-[0.9375rem] font-medium text-foreground">
                    {band.label}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
                    {band.example}
                  </p>
                </div>
                {/* `gain`, never brand green — this is a number going up. */}
                <p className="text-[1.25rem] font-semibold tabular-nums text-gain">
                  {formatBps(band.bps)}
                  <span className="ml-0.5 text-[0.75rem] font-normal text-muted-foreground">
                    /yr
                  </span>
                </p>
              </Reveal>
            ))}
          </ul>
        </div>

        <Reveal delay={120}>
          <ReturnsCalculator />
        </Reveal>
      </div>
    </Section>
  );
}
