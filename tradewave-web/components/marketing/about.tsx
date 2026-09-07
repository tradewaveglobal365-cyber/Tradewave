import { ABOUT } from '@/content/home';
import { Section, SectionHeader } from './section';
import { Reveal } from './reveal';

export function About() {
  return (
    <Section id="about" tone="canvas">
      <div className="grid gap-14 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:gap-20">
        <div>
          <SectionHeader eyebrow={ABOUT.eyebrow} heading={ABOUT.heading} />

          <Reveal delay={80} className="mt-6 space-y-5">
            {ABOUT.body.map((paragraph) => (
              <p
                key={paragraph.slice(0, 32)}
                className="text-[1.0625rem] leading-relaxed text-pretty text-muted-foreground"
              >
                {paragraph}
              </p>
            ))}
          </Reveal>

          <ul className="mt-10 space-y-6 border-t border-hairline pt-9">
            {ABOUT.points.map((point, index) => (
              <Reveal as="li" key={point.title} delay={index * 70}>
                <h3 className="text-[0.9375rem] font-semibold text-foreground">
                  {point.title}
                </h3>
                <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted-foreground">
                  {point.body}
                </p>
              </Reveal>
            ))}
          </ul>
        </div>

        <Reveal delay={120} className="lg:sticky lg:top-24">
          <FractionDiagram />
        </Reveal>
      </div>
    </Section>
  );
}

/**
 * One property, divided.
 *
 * A 6×4 grid of cells standing in for the whole asset, with five filled to
 * represent a single investor's stake. Deliberately abstract — a literal
 * illustration of a building would fight the photography elsewhere on the page.
 */
function FractionDiagram() {
  const COLUMNS = 6;
  const ROWS = 4;
  const TOTAL = COLUMNS * ROWS;
  /** Which cells read as "yours". Scattered, not a block — shares aren't rooms. */
  const OWNED = new Set([7, 8, 13, 14, 19]);

  return (
    <figure className="rounded-2xl border border-hairline bg-surface p-7 shadow-sm">
      <figcaption className="mb-6 flex items-baseline justify-between gap-4">
        <span className="text-[0.8125rem] font-semibold text-foreground">
          One property
        </span>
        <span className="text-[0.75rem] text-muted-foreground">
          {OWNED.size} of {TOTAL} shares held
        </span>
      </figcaption>

      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {Array.from({ length: TOTAL }, (_, index) => (
          <span
            key={index}
            className={
              OWNED.has(index)
                ? 'aspect-square rounded-md bg-brand-600'
                : 'aspect-square rounded-md bg-brand-100'
            }
          />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline pt-5">
        <span className="flex items-center gap-2 text-[0.75rem] text-muted-foreground">
          <span className="size-2.5 rounded-[3px] bg-brand-600" />
          Your stake
        </span>
        <span className="flex items-center gap-2 text-[0.75rem] text-muted-foreground">
          <span className="size-2.5 rounded-[3px] bg-brand-100" />
          Held by other investors
        </span>
      </div>
    </figure>
  );
}
