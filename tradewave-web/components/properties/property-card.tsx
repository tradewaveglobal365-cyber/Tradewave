import Link from 'next/link';
import { MapPin } from 'lucide-react';
import type { Property } from '@/lib/types';
import { formatBps, formatAedCompact, formatTerm } from '@/lib/money';
import { FundingBar } from './funding-bar';

export function PropertyCard({ property }: { property: Property }) {
  const isFunded = property.status === 'FUNDED';

  return (
    <Link
      href={`/properties/${property.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-hairline bg-surface transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        {/* Plain img rather than next/image: seed URLs are remote placeholders
            that will be replaced with real uploads, and configuring
            remotePatterns for throwaway hosts is churn. Revisit at upload. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={property.images[0]}
          alt=""
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          loading="lazy"
        />
        {isFunded ? (
          // Gold appears here and almost nowhere else — it marks the one state
          // worth celebrating.
          <span className="absolute top-3 right-3 rounded-full bg-gold-500 px-2.5 py-1 text-[0.6875rem] font-semibold text-brand-900">
            Fully funded
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[0.9375rem] font-semibold text-foreground">{property.title}</h3>
        <p className="mt-1 flex items-center gap-1 text-[0.75rem] text-muted-foreground">
          <MapPin className="size-3" />
          {property.area}, {property.city}
        </p>

        <div className="mt-3.5 flex items-end justify-between">
          <div>
            <p className="text-[0.6875rem] text-muted-foreground">Property value</p>
            <p className="text-[1.0625rem] font-semibold text-foreground">
              {formatAedCompact(property.totalValueFils)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[0.6875rem] text-muted-foreground">Return</p>
            {/* `gain`, never brand green — this is a number going up. */}
            <p className="text-[1.0625rem] font-semibold text-gain">
              {formatBps(property.annualReturnBps)}
              <span className="ml-0.5 text-[0.6875rem] font-normal text-muted-foreground">
                /yr
              </span>
            </p>
          </div>
        </div>

        <div className="mt-auto pt-4">
          <FundingBar property={property} />
          <p className="mt-2.5 text-[0.75rem] text-muted-foreground">
            From{' '}
            <span className="font-medium text-foreground">
              {formatAedCompact(property.minInvestmentFils)}
            </span>{' '}
            &middot; {formatTerm(property.termMonths)} term
          </p>
        </div>
      </div>
    </Link>
  );
}
