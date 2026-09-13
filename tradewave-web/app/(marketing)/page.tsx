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
import { Testimonials } from '@/components/marketing/testimonials';
import { Faq } from '@/components/marketing/faq';
import { CtaBand } from '@/components/marketing/cta-band';

/**
 * Marketing homepage.
 *
 * Pure content — no API calls, no cookies, no request-time data of any kind, so
 * the whole route prerenders at build time. `npm run build` must list `/` as
 * `○ (Static)`; if it ever shows as dynamic, something has leaked a
 * request-scoped dependency in here.
 *
 * All copy lives in content/home.ts.
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
const description =
  'Own a share of freehold Dubai property from $250. Title-verified listings, registered with the Dubai Land Department, yielding 6.9%–10.5% a year.';

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

export default function HomePage() {
  return (
    <>
      <Hero />
      <TrustBar />
      <About />
      {/* Straight after About explains what a fraction IS — the visitor should
          not have to read three more abstract blocks before seeing one. */}
      <PropertyShowcase />
      <HowItWorks />
      <Comparison />
      <WhyDubai />
      <AutoInvest />
      <Returns />
      <Security />
      <Testimonials />
      <Faq />
      <CtaBand />
    </>
  );
}
