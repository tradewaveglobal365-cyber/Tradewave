import Link from 'next/link';
import { ArrowRight, Lock } from 'lucide-react';
import { PROPERTY_SHOWCASE } from '@/content/home';
import type { PublicProperty } from '@/lib/public-properties';
import { Section, SectionHeader } from './section';
import { Reveal } from './reveal';
import { PropertyShowcaseCard } from './property-showcase-card';

/**
 * The portfolio, on the public page.
 *
 * Reads real listings, passed down from the page. This used to render six
 * hardcoded properties that existed nowhere but this file — with prices, yields
 * and a working "start investing" path — because a prerendered page could not
 * reach the database. It is now regenerated hourly from the API instead, so
 * what is advertised here is what is actually for sale.
 *
 * Layout: a snap-scrolling row on phones, a grid from `sm` up. The row is pure
 * CSS — `overflow-x-auto` plus scroll snapping — so this stays a Server
 * Component with no carousel library.
 */
export function PropertyShowcase({ properties }: { properties: PublicProperty[] }) {

  return (
    <Section id="properties" tone="surface">
      <SectionHeader
        eyebrow={PROPERTY_SHOWCASE.eyebrow}
        heading={PROPERTY_SHOWCASE.heading}
        description={PROPERTY_SHOWCASE.description}
      />


      {/*
        `-mx-6` cancels the Section's own padding so the row bleeds to the screen
        edge on phones, and `px-6` puts the inset back on the content — so the
        first card starts flush with the heading and the last one can scroll
        past the edge. Both are dropped at `sm`, where this becomes a grid.

        The scroll happens inside this element, never on the body.
      */}
      {properties.length === 0 ? (
        // Nothing listed. An honest empty state, not a placeholder grid — a
        // visitor who sees six properties that do not exist and signs up for
        // them has been misled, and there is no version of that which is
        // better than saying "not yet".
        <Reveal className="mt-12 rounded-xl border border-dashed border-hairline bg-canvas px-6 py-12 text-center">
          <p className="text-[0.9375rem] font-medium text-foreground">
            Listings are being prepared
          </p>
          <p className="mx-auto mt-2 max-w-md text-[0.875rem] leading-relaxed text-muted-foreground">
            Every property is title-verified and registered with the Dubai Land Department
            before it appears here. Create an account and we will tell you the moment the
            first one opens.
          </p>
          <Link
            href="/signup"
            className="mt-5 inline-flex items-center gap-1.5 rounded-md text-[0.875rem] font-medium text-brand-700 hover:text-brand-800 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Create an account
            <ArrowRight className="size-4" />
          </Link>
        </Reveal>
      ) : (
        <ul className="mt-12 -mx-6 flex snap-x snap-mandatory gap-5 overflow-x-auto px-6 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3">
          {properties.map((property, index) => (
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
      )}

      {properties.length > 0 ? (
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
      ) : null}
    </Section>
  );
}
