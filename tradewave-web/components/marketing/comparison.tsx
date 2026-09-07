import { Check } from 'lucide-react';
import { COMPARISON } from '@/content/home';
import { Section, SectionHeader } from './section';
import { Reveal } from './reveal';

/**
 * Fractional ownership against the alternatives.
 *
 * ⚠️  Qualitative on purpose. A savings rate or a REIT yield would have to be
 * invented, and a comparison table is where an invented number does the most
 * damage — a reader takes it as a like-for-like fact. The only figure here is
 * Tradewave's own minimum, computed from the portfolio.
 *
 * The `note` below the table carries the honest cost of the model (illiquidity).
 * It is not optional decoration: a comparison that only lists what Tradewave
 * wins is an advertisement, not an argument.
 */
export function Comparison() {
  return (
    <Section id="comparison" tone="surface">
      <SectionHeader
        eyebrow={COMPARISON.eyebrow}
        heading={COMPARISON.heading}
        description={COMPARISON.description}
      />

      {/*
        The table scrolls inside this wrapper — the page body must never scroll
        horizontally. `-mx-6 px-6` lets it use the full screen width on phones
        before the inner scroll takes over.
      */}
      <Reveal className="mt-12 -mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
        {/*
          `table-fixed` so the four options get equal width. With auto layout the
          browser sizes each column to its longest cell, which made "Savings
          account" a squeezed 90px next to a 270px Tradewave column — and in a
          comparison, unequal columns read as a thumb on the scale.
        */}
        <table className="w-full min-w-[48rem] table-fixed border-collapse text-left">
          <caption className="sr-only">
            Tradewave compared with buying a property outright, a REIT, and a
            savings account
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-[15%] pb-4" />
              {COMPARISON.columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={
                    index === 0
                      ? 'rounded-t-xl bg-brand-900 px-5 pt-5 pb-4 text-[0.875rem] font-semibold text-white'
                      : 'px-5 pt-5 pb-4 text-[0.875rem] font-semibold text-muted-foreground'
                  }
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON.rows.map((row) => (
              <tr key={row.label} className="border-t border-hairline">
                <th
                  scope="row"
                  className="py-5 pr-5 align-top text-[0.75rem] font-semibold tracking-[0.08em] uppercase text-muted-foreground"
                >
                  {row.label}
                </th>
                {row.cells.map((cell, index) => (
                  <td
                    key={index}
                    className={
                      index === 0
                        ? 'bg-brand-900/[0.04] px-5 py-5 align-top text-[0.875rem] leading-relaxed text-pretty font-medium text-foreground'
                        : 'px-5 py-5 align-top text-[0.875rem] leading-relaxed text-pretty text-muted-foreground'
                    }
                  >
                    {index === 0 ? (
                      <span className="flex gap-2">
                        <Check
                          aria-hidden="true"
                          className="mt-0.5 size-3.5 shrink-0 text-brand-600"
                          strokeWidth={2.5}
                        />
                        {cell}
                      </span>
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Reveal>

      <Reveal delay={120}>
        <p className="mt-8 max-w-2xl border-t border-hairline pt-6 text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
          {COMPARISON.note}
        </p>
      </Reveal>
    </Section>
  );
}
