import { FileLock2, Fingerprint, Landmark, Receipt, Sigma } from 'lucide-react';
import { SECURITY } from '@/content/home';
import { Section, SectionHeader } from './section';
import { Reveal } from './reveal';

const ICONS = [FileLock2, Receipt, Sigma, Fingerprint, Landmark] as const;

/**
 * "Where your money actually sits."
 *
 * Every claim here is verified against tradewave-api — see the sourcing table
 * in content/home.ts. Nothing in this section is aspirational.
 *
 * ⚠️  It makes NO claim about Tradewave's own licensing, regulatory standing, or
 * custody of client funds. That is the same line the FAQ holds and it is
 * deliberate: legal has not confirmed the position in writing. This section
 * describes what the SYSTEM does and what DUBAI PROPERTY LAW does. Do not
 * strengthen it into "Tradewave is regulated" or "funds are held in escrow".
 */
export function Security() {
  return (
    <Section id="security" tone="surface">
      <SectionHeader
        eyebrow={SECURITY.eyebrow}
        heading={SECURITY.heading}
        description={SECURITY.description}
      />

      {/*
        Five points into a three-column grid leaves a two-card orphan row. The
        first two spend the extra width on the two least intuitive claims, so
        the shortfall reads as emphasis rather than as a layout accident.
      */}
      <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-6">
        {SECURITY.points.map((point, index) => {
          const Icon = ICONS[index] ?? FileLock2;
          return (
            <Reveal
              as="li"
              key={point.title}
              delay={index * 70}
              className={
                index < 2
                  ? 'rounded-xl border border-hairline bg-canvas p-6 lg:col-span-3'
                  : 'rounded-xl border border-hairline bg-canvas p-6 lg:col-span-2'
              }
            >
              <span className="inline-flex size-9 items-center justify-center rounded-lg bg-brand-100">
                <Icon className="size-4 text-brand-700" strokeWidth={2} />
              </span>
              <h3 className="mt-4 text-[0.9375rem] font-semibold text-foreground">
                {point.title}
              </h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
                {point.body}
              </p>
            </Reveal>
          );
        })}
      </ul>
    </Section>
  );
}
