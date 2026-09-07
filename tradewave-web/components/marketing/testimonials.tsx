import { TESTIMONIALS } from '@/content/home';
import { Section, SectionHeader } from './section';
import { Reveal } from './reveal';

/**
 * ⚠️  All three quotes are placeholders — see content/home.ts.
 *
 * Rendered as initials monograms rather than photographs on purpose. Pairing a
 * fabricated quote with a stock photograph of a real person is a materially
 * worse thing to ship than the quote on its own, and it makes the placeholder
 * harder to spot before launch.
 */
export function Testimonials() {
  const isDev = process.env.NODE_ENV === 'development';

  return (
    <Section id="testimonials" tone="canvas">
      <SectionHeader
        eyebrow={TESTIMONIALS.eyebrow}
        heading={TESTIMONIALS.heading}
        align="center"
      />

      {isDev && TESTIMONIALS.placeholder ? (
        <p className="mx-auto mt-5 w-fit rounded-md bg-pending/15 px-2.5 py-1 text-[0.75rem] font-semibold text-pending">
          TODO(content): placeholder quotes — replace or delete before launch
        </p>
      ) : null}

      <ul className="mt-14 grid gap-5 md:grid-cols-3">
        {TESTIMONIALS.items.map((item, index) => (
          <Reveal
            as="li"
            key={item.name}
            delay={index * 90}
            className="flex flex-col rounded-xl border border-hairline bg-surface p-6"
          >
            <blockquote className="flex-1 text-[0.9375rem] leading-relaxed text-pretty text-foreground">
              &ldquo;{item.quote}&rdquo;
            </blockquote>

            <figcaption className="mt-6 flex items-center gap-3 border-t border-hairline pt-5">
              <span
                aria-hidden="true"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[0.8125rem] font-semibold text-brand-800"
              >
                {initials(item.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[0.875rem] font-medium text-foreground">
                  {item.name}
                </span>
                <span className="block truncate text-[0.75rem] text-muted-foreground">
                  {item.role} &middot; {item.location}
                </span>
              </span>
            </figcaption>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}

/** "Amira K." -> "AK" */
function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .replace(/[^A-Z]/gi, '')
    .slice(0, 2)
    .toUpperCase();
}
