import { MarketingNav } from '@/components/marketing/nav';
import { MarketingFooter } from '@/components/marketing/footer';
import { StickyCta } from '@/components/marketing/sticky-cta';

/**
 * Public marketing shell. A route group rather than a bare page so /about,
 * /contact and the legal pages can join later under the same navbar and footer
 * without restructuring anything.
 *
 * The navbar is `fixed` and overlays the hero, so `main` carries no top padding
 * — each page's first section is responsible for clearing it.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      {/*
        Reveal animations start hidden and are un-hidden by an
        IntersectionObserver in components/marketing/reveal.tsx. With JavaScript
        disabled that observer never runs, so this rule is what keeps the page
        from rendering blank. Removing it silently breaks the no-JS experience.
      */}
      <noscript>
        <style>{`[data-reveal]{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />

      {/* Mobile-only; hides itself over the hero and again over the CTA band. */}
      <StickyCta />
    </div>
  );
}
