'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { STICKY_CTA } from '@/content/home';
import { cn } from '@/lib/utils';

/**
 * Slim mobile-only action bar.
 *
 * The page runs thirteen blocks. On a phone the hero's CTA is offscreen for
 * almost the entire visit, so the one thing we want a visitor to do has no
 * affordance for most of their time on the page.
 *
 * Two IntersectionObservers rather than a scroll listener, matching
 * `reveal.tsx`:
 *
 *   · `#hero` stops intersecting  → the hero's own CTA is gone, so arm this one
 *   · `#cta`  starts intersecting → the page's real CTA band is on screen, so
 *                                   get out of its way rather than floating a
 *                                   duplicate button over it
 *
 * Layering: the nav is `z-50` and its mobile menu panel `z-40`. This sits at
 * `z-30`, so the opaque full-height panel simply covers it when the menu opens
 * and the two components need no shared state.
 */
export function StickyCta() {
  const [pastHero, setPastHero] = useState(false);
  const [atCta, setAtCta] = useState(false);

  useEffect(() => {
    const hero = document.getElementById('hero');
    const cta = document.getElementById('cta');

    const observers: IntersectionObserver[] = [];

    if (hero) {
      const heroObserver = new IntersectionObserver(
        ([entry]) => setPastHero(!entry?.isIntersecting),
        { threshold: 0 },
      );
      heroObserver.observe(hero);
      observers.push(heroObserver);
    }

    if (cta) {
      const ctaObserver = new IntersectionObserver(
        ([entry]) => setAtCta(Boolean(entry?.isIntersecting)),
        // Arm slightly early so the bar is gone before the band's own buttons
        // reach the thumb, rather than swapping under it.
        { rootMargin: '0px 0px 120px 0px', threshold: 0 },
      );
      ctaObserver.observe(cta);
      observers.push(ctaObserver);
    }

    return () => observers.forEach((observer) => observer.disconnect());
  }, []);

  const visible = pastHero && !atCta;

  return (
    <div
      // `inert` keeps the hidden bar out of the tab order — it stays in the DOM
      // so it can slide rather than pop, and a focusable button behind a
      // translated overlay is a keyboard trap waiting to happen.
      inert={!visible}
      aria-hidden={!visible}
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface/95 backdrop-blur transition-transform duration-300 ease-out motion-reduce:transition-none lg:hidden',
        // Clears the iPhone home indicator on devices that have one.
        'pb-[env(safe-area-inset-bottom)]',
        visible ? 'translate-y-0' : 'translate-y-full',
      )}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-3">
        <p className="min-w-0 text-[0.75rem] leading-tight text-muted-foreground">
          {STICKY_CTA.label}
          <span className="block text-[1rem] font-semibold text-foreground">
            {STICKY_CTA.value}
          </span>
        </p>
        <Button asChild className="h-11 shrink-0 px-5 text-base">
          <Link href={STICKY_CTA.action.href}>{STICKY_CTA.action.label}</Link>
        </Button>
      </div>
    </div>
  );
}
