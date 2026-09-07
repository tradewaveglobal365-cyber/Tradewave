import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HERO } from '@/content/home';
import { Reveal } from './reveal';

/**
 * Hero — light.
 *
 * This deliberately does NOT use the forest ground.
 *
 * The dark treatment stacked three saturated greens on top of each other
 * (brand-900, then two green radial washes, then a green gradient across half
 * the photograph) and the result read as a wall of forest with the photo
 * drowned in it. Green now appears only where it means something: the filled
 * button, the check marks, and the gold eyebrow dot.
 *
 * The forest ground is still the identity — it carries the auth panel, the
 * auto-invest section and the CTA band. Keeping it OUT of the hero is what
 * makes those sections land as contrast rather than as more of the same.
 */
export function Hero() {
  return (
    <section id="hero" className="relative isolate overflow-hidden bg-canvas">
      {/*
        Warm neutral blueprint grid — the same motif as the auth panel, but in
        the hairline colour rather than white-on-green, so it reads as paper
        texture instead of another layer of green.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--color-hairline) 1px, transparent 1px), linear-gradient(to bottom, var(--color-hairline) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(120% 80% at 20% 10%, #000 0%, transparent 70%)',
        }}
      />

      <div className="relative mx-auto grid w-full max-w-6xl gap-14 px-6 pt-28 pb-20 sm:pt-32 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:pt-36 lg:pb-28">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1 text-[0.75rem] font-medium text-brand-800 shadow-sm">
            <span className="size-1.5 rounded-full bg-gold-500" />
            {HERO.eyebrow}
          </span>

          <h1 className="mt-6 text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance text-foreground sm:text-[3.25rem] lg:text-[3.5rem]">
            {HERO.headline}
          </h1>

          <p className="mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-pretty text-muted-foreground">
            {HERO.subhead}
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild className="h-12 gap-1.5 px-6 text-base">
              <Link href={HERO.primaryCta.href}>
                {HERO.primaryCta.label}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-12 bg-surface px-6 text-base">
              <a href={HERO.secondaryCta.href}>{HERO.secondaryCta.label}</a>
            </Button>
          </div>

          <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-3 border-t border-hairline pt-7">
            {HERO.chips.map((chip) => (
              <li
                key={chip}
                className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground"
              >
                <Check className="size-3.5 shrink-0 text-brand-600" strokeWidth={2.5} />
                {chip}
              </li>
            ))}
          </ul>
        </Reveal>

        {/*
          In the grid rather than absolutely positioned. On the light ground
          there is no seam to hide, so the photograph can simply be a framed
          card and show its own colour at full strength.
        */}
        <Reveal
          delay={120}
          className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-muted shadow-xl ring-1 ring-hairline sm:aspect-[3/2] lg:aspect-[4/5]"
        >
          <Image
            src={HERO.image.src}
            alt={HERO.image.alt}
            fill
            sizes="(min-width: 1024px) 46vw, 100vw"
            className="object-cover"
            /*
              Next 16 deprecated `priority` in favour of explicit loading hints.
              This is the LCP element, so it must not be lazy.
            */
            loading="eager"
            fetchPriority="high"
          />
        </Reveal>
      </div>
    </section>
  );
}
