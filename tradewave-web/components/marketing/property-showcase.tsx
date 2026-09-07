import Link from 'next/link';
import { ArrowRight, Lock } from 'lucide-react';
import { PROPERTIES, PROPERTY_SHOWCASE } from '@/content/home';
import { Section, SectionHeader } from './section';
import { Reveal } from './reveal';
import { PropertyShowcaseCard } from './property-showcase-card';

/**
 * The portfolio, on the public page.
 *
 * ⚠️  All six listings are placeholders mirrored from
 * tradewave-api/prisma/seed.ts, whose own header notes that none of the
 * photographs depicts the property described. Replace them with real,
 * title-verified listings before this page is shown to an investor. The badge
 * below renders in development only, so the team cannot quietly forget.
 *
 * Layout: a snap-scrolling row on phones, a grid from `sm` up. The row is pure
 * CSS — `overflow-x-auto` plus scroll snapping — so this stays a Server
 * Component with no carousel library.
 */
export function PropertyShowcase() {
  const isDev = process.env.NODE_ENV === 'development';
  const hasPlaceholders = PROPERTIES.some((property) => property.placeholder);

  return (
    <Section id="properties" tone="surface">
      <SectionHeader
        eyebrow={PROPERTY_SHOWCASE.eyebrow}
        heading={PROPERTY_SHOWCASE.heading}
        description={PROPERTY_SHOWCASE.description}
      />

      {isDev && hasPlaceholders ? (
        <p className="mt-5 w-fit rounded-md bg-pending/15 px-2.5 py-1 text-[0.75rem] font-semibold text-pending">
          TODO(content): all {PROPERTIES.length} listings are placeholders with
          non-representative photography — replace before launch
        </p>
      ) : null}

      {/*
        `-mx-6` cancels the Section's own padding so the row bleeds to the screen
        edge on phones, and `px-6` puts the inset back on the content — so the
        first card starts flush with the heading and the last one can scroll
        past the edge. Both are dropped at `sm`, where this becomes a grid.

        The scroll happens inside this element, never on the body.
      */}
      <ul className="mt-12 -mx-6 flex snap-x snap-mandatory gap-5 overflow-x-auto px-6 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3">
        {PROPERTIES.map((property, index) => (
          <Reveal
            as="li"
            key={property.slug}
            delay={index * 70}
            className="w-[78vw] shrink-0 snap-start sm:w-auto sm:shrink"
          >
            <PropertyShowcaseCard property={property} />
          </Reveal>
        ))}
      </ul>

      <Reveal className="mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
          <Lock className="size-3.5 shrink-0" strokeWidth={2} />
          {PROPERTY_SHOWCASE.note}
        </p>
        <Link
          href={PROPERTY_SHOWCASE.allCta.href}
          className="inline-flex items-center gap-1.5 rounded-md text-[0.875rem] font-medium text-brand-700 hover:text-brand-800 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {PROPERTY_SHOWCASE.allCta.label}
          <ArrowRight className="size-4" />
        </Link>
      </Reveal>
    </Section>
  );
}
