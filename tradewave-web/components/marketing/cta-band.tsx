import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CTA } from '@/content/home';
import { DarkGround } from './section';
import { Reveal } from './reveal';

/**
 * Closing call to action. The gold hairline here is the second and last gold
 * accent on the page — it mirrors the rule under the logo on the auth panel.
 */
export function CtaBand() {
  return (
    <section id="cta" className="relative overflow-hidden bg-brand-900 text-white">
      <DarkGround />

      <div className="relative mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="mx-auto mb-7 block h-0.5 w-9 bg-gold-500" />

          <h2 className="text-[1.875rem] leading-[1.12] font-semibold tracking-[-0.03em] text-balance sm:text-[2.375rem]">
            {CTA.heading}
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[1.0625rem] leading-relaxed text-pretty text-brand-200">
            {CTA.body}
          </p>

          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild className="h-12 gap-1.5 px-6 text-base">
              <Link href={CTA.primary.href}>
                {CTA.primary.label}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-12 border-white/25 bg-transparent px-6 text-base text-white hover:bg-white/10 hover:text-white"
            >
              <Link href={CTA.secondary.href}>{CTA.secondary.label}</Link>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
