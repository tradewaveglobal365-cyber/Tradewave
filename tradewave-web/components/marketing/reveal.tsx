'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Scroll-triggered fade-and-rise.
 *
 * No animation library — an IntersectionObserver and two Tailwind classes do
 * the whole job, and `tw-animate-css` is already available if a keyframe is
 * ever needed.
 *
 * Three things keep this from hiding content by accident:
 *
 * 1. Under `prefers-reduced-motion: reduce` the `motion-reduce:transition-none`
 *    class drops the transition, so content snaps in rather than animating.
 *    Handling it that way rather than with a `matchMedia` call in the effect
 *    keeps this free of a synchronous setState during render.
 * 2. The observer fires on mount for anything already in the viewport, so
 *    above-the-fold content never waits for a scroll event that will not come.
 * 3. If JavaScript never runs at all, the `<noscript>` rule in
 *    `app/(marketing)/layout.tsx` forces every `[data-reveal]` visible. The
 *    initial markup is deliberately hidden, so that fallback is load-bearing —
 *    do not remove one without the other.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  /** Milliseconds, for staggering siblings. Keep under ~300ms. */
  delay?: number;
  /**
   * `ElementType` rather than a union of tag names: a union makes TypeScript
   * intersect the ref types of every member, which nothing can then satisfy.
   */
  as?: React.ElementType;
}) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setRevealed(true);
        // Once revealed, stop watching — this never animates back out.
        observer.disconnect();
      },
      /*
        Positive margins arm the reveal ~200px BEFORE the element enters the
        viewport. Holding it until the element is properly on screen looked
        better in isolation but meant a fast scroll landed on a section that was
        still blank — on a marketing page that reads as a broken build.
      */
      { rootMargin: '200px 0px 200px 0px', threshold: 0 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      data-reveal=""
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        'transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none',
        revealed ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
