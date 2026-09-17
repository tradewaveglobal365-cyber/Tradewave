import type { Metadata } from 'next';
import { Hero } from '@/components/marketing/hero';
import { TrustBar } from '@/components/marketing/trust-bar';
import { About } from '@/components/marketing/about';
import { PropertyShowcase } from '@/components/marketing/property-showcase';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { Comparison } from '@/components/marketing/comparison';
import { WhyDubai } from '@/components/marketing/why-dubai';
import { AutoInvest } from '@/components/marketing/auto-invest';
import { Returns } from '@/components/marketing/returns';
import { Security } from '@/components/marketing/security';
import { Faq } from '@/components/marketing/faq';
import { CtaBand } from '@/components/marketing/cta-band';
import { deriveStats, getShowcaseProperties } from '@/lib/public-properties';

/**
 * Marketing homepage.
 *
 * Still served as static HTML, but REGENERATED from the listings API rather
 * than prerendered once from hardcoded content. That is the whole point: this
 * page used to carry its own copy of six properties, because a purely static
 * page cannot read a database — and those six did not exist. Incremental
 * regeneration gets the speed of a static page without the invented data.
 *
 * No cookies and no request-scoped data, so it must never become per-request
 * dynamic. `npm run build` should list `/` as a static or revalidating route;
 * if it ever shows as fully dynamic, something has leaked a request-scoped
 * dependency in here.
 *
 * Copy lives in content/home.ts. NUMBERS about current listings do not — they
 * are derived here from real data and passed down, and when there is nothing
 * listed the sentences that would have quoted one are not rendered at all.
 *
 * Section grounds alternate canvas / surface so no two adjacent blocks share a
 * background, with the two dark sections as the punctuation:
 *
 *   About canvas · Properties surface · HowItWorks canvas · Comparison surface
 *   · WhyDubai canvas · AutoInvest DARK · Returns canvas · Security surface
 *   · Testimonials canvas · Faq surface · CtaBand DARK
 *
 * Inserting a section here means re-checking the run — `tone` lives on each
 * component, so nothing enforces this but the eye.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

const title = 'Tradewave · Fractional Dubai real estate investment';
// No figures. This is static metadata on a page whose listings change, and the
// "$250" and "6.9%-10.5%" it used to quote were derived from six properties
// that did not exist. A number in a meta description is also the one piece of
// copy nobody re-reads when the listings change.
const description =
  'Own a share of freehold Dubai real estate. Title-verified listings registered with the Dubai Land Department, with the minimum and the rate shown in full on every property.';

export const metadata: Metadata = {
  // app/layout.tsx uses `template: '%s'`, so this is the full title as written.
  title,
  description,
  metadataBase: new URL(APP_URL),
  alternates: { canonical: '/' },
  openGraph: {
    title,
    description,
    url: '/',
    siteName: 'Tradewave',
    type: 'website',
    locale: 'en_AE',
  },
  twitter: { card: 'summary_large_image', title, description },
};

/**
 * How long the page may quote listing figures before it is rebuilt.
 *
 * A literal, not the shared constant: Next statically analyses segment config
 * exports at build time and rejects anything it cannot read without running
 * the module. SHOWCASE_REVALIDATE_SECONDS still drives the fetch itself, where
 * a variable is fine — keep the two in step.
 */
export const revalidate = 3600;

export default async function HomePage() {
  const properties = await getShowcaseProperties();
  const stats = deriveStats(properties);

  return (
    <>
      <Hero stats={stats} />
      <TrustBar stats={stats} />
      <About />
      {/* Straight after About explains what a fraction IS — the visitor should
          not have to read three more abstract blocks before seeing one. */}
      <PropertyShowcase properties={properties} />
      <HowItWorks />
      <Comparison />
      <WhyDubai />
      <AutoInvest />
      <Returns stats={stats} />
      <Security />
      <Faq />
      <CtaBand />
    </>
  );
}
