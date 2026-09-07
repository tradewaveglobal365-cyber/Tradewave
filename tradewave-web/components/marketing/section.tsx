import { cn } from '@/lib/utils';
import { Reveal } from './reveal';

/**
 * Shared section shell — vertical rhythm, max width, and the eyebrow/heading
 * block that nine sections would otherwise each reinvent slightly differently.
 *
 * `tone` switches the whole section between the warm canvas and the forest
 * ground used on the auth panel. The dark treatment (radial washes + blueprint
 * grid) lives in `DarkGround` below so the hero, auto-invest section and CTA
 * band all read as the same surface.
 *
 * Note on gold: the eyebrow here is brand green, NOT gold. README limits gold to
 * roughly one accent per screen, and it is spent on the hero eyebrow dot and the
 * CTA band hairline. An eyebrow rule on every section would burn it eight times.
 */
export function Section({
  id,
  tone = 'canvas',
  className,
  children,
}: {
  id?: string;
  tone?: 'canvas' | 'surface' | 'dark';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      // scroll-mt clears the sticky navbar when an anchor link jumps here.
      className={cn(
        'scroll-mt-16 py-20 sm:py-28',
        tone === 'canvas' && 'bg-canvas',
        tone === 'surface' && 'bg-surface',
        tone === 'dark' && 'relative overflow-hidden bg-brand-900 text-white',
        className,
      )}
    >
      {tone === 'dark' ? <DarkGround /> : null}
      <div className="relative mx-auto w-full max-w-6xl px-6">{children}</div>
    </section>
  );
}

/**
 * The forest ground from `app/(auth)/layout.tsx` — two soft radial washes for
 * depth plus a faint architectural grid that reads as blueprint rather than
 * decoration. Extracted here so the landing page and the auth screens stay
 * visibly the same product.
 *
 * The washes sit at 40%, not the auth panel's 70%. Those washes are brand-700
 * and brand-800 over a brand-900 base, so a high opacity pushes broad areas
 * toward the brighter, more saturated green — over a full-width marketing
 * section that reads as loud rather than deep. Lower opacity lets brand-900
 * stay the ground and keeps the washes doing what they are for, which is
 * depth. Raise this and the section starts shouting again.
 */
export function DarkGround() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'radial-gradient(120% 90% at 12% 0%, #12664B 0%, transparent 55%), radial-gradient(100% 80% at 100% 100%, #0E5139 0%, transparent 60%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }}
      />
    </>
  );
}

export function SectionHeader({
  eyebrow,
  heading,
  description,
  tone = 'light',
  align = 'start',
  className,
}: {
  eyebrow: string;
  heading: string;
  description?: string;
  tone?: 'light' | 'dark';
  align?: 'start' | 'center';
  className?: string;
}) {
  const isDark = tone === 'dark';

  return (
    <Reveal
      className={cn(
        'max-w-2xl',
        align === 'center' && 'mx-auto text-center',
        className,
      )}
    >
      <p
        className={cn(
          'text-[0.75rem] font-semibold tracking-[0.14em] uppercase',
          isDark ? 'text-brand-300' : 'text-brand-600',
        )}
      >
        {eyebrow}
      </p>
      <h2
        className={cn(
          'mt-3 text-[1.875rem] leading-[1.12] font-semibold tracking-[-0.03em] text-balance sm:text-[2.375rem]',
          isDark ? 'text-white' : 'text-foreground',
        )}
      >
        {heading}
      </h2>
      {description ? (
        <p
          className={cn(
            'mt-4 text-[1.0625rem] leading-relaxed text-pretty',
            isDark ? 'text-brand-200' : 'text-muted-foreground',
          )}
        >
          {description}
        </p>
      ) : null}
    </Reveal>
  );
}
