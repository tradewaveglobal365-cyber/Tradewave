import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, MapPin } from 'lucide-react';
import { formatBps, formatTerm, formatUsd, formatUsdCompact } from '@/lib/money';
import type { PublicProperty } from '@/lib/public-properties';

/**
 * Marketing property card.
 *
 * Takes the API's shape — cents as strings — like every other card in the app.
 * It used to take plain numbers typed into content/home.ts, because this page
 * was prerendered from a hardcoded list; now the page is regenerated from real
 * listings, so there is one shape and one set of formatters.
 *
 * Shows only what is fixed at listing: value, yield, term, minimum. It shows NO
 * funding progress, no "% funded", no investor count. Those are live state and
 * this page is regenerated at most hourly, so a stale funding bar is precisely
 * the number a visitor would act on.
 *
 * The href is the real, protected route. `proxy.ts` bounces a logged-out visitor
 * to `/login?next=/properties/<slug>`, and `login-form.tsx` honours `next` — so
 * signing in lands them on the property they actually clicked.
 */
export function PropertyShowcaseCard({ property }: { property: PublicProperty }) {
  const image = property.images[0] ?? null;

  return (
    <Link
      href={`/properties/${property.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-hairline bg-canvas transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        {image ? (
          <Image
            src={image}
            alt=""
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 78vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          // A listing with no photograph yet still belongs on the page — an
          // empty frame is honest, a stock photo of somewhere else is not.
          <div className="flex h-full items-center justify-center">
            <MapPin className="size-6 text-muted-foreground/40" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-[0.9375rem] font-semibold text-foreground">{property.title}</h3>
        <p className="mt-1 flex items-center gap-1 text-[0.75rem] text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          {property.area}, {property.city}
        </p>

        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[0.6875rem] text-muted-foreground">Property value</p>
            <p className="text-[1.0625rem] font-semibold tabular-nums text-foreground">
              {formatUsdCompact(property.totalValueCents)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[0.6875rem] text-muted-foreground">Return</p>
            {/* `gain`, never brand green — this is a number going up. */}
            <p className="text-[1.0625rem] font-semibold tabular-nums text-gain">
              {formatBps(property.annualReturnBps)}
              <span className="ml-0.5 text-[0.6875rem] font-normal text-muted-foreground">
                /yr
              </span>
            </p>
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-hairline pt-5">
          <p className="text-[0.75rem] text-muted-foreground">
            From{' '}
            <span className="font-medium text-foreground">
              {formatUsd(property.minInvestmentCents)}
            </span>{' '}
            &middot; {formatTerm(property.termMonths)} term
          </p>
          <ArrowRight
            aria-hidden="true"
            className="size-4 shrink-0 text-brand-600 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </div>
      </div>
    </Link>
  );
}
