import type { Metadata } from 'next';
import { getProperties } from '@/lib/properties';
import { PropertyCard } from '@/components/properties/property-card';

export const metadata: Metadata = { title: 'Properties · Tradewave' };

export default async function PropertiesPage() {
  const list = await getProperties();

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-[1.625rem] font-semibold tracking-[-0.025em] text-foreground">
          Properties
        </h1>
        <p className="mt-1 text-[0.9375rem] text-muted-foreground">
          Buy a fraction of a vetted property. Invest from as little as the listed minimum.
        </p>
      </header>

      {!list || list.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface/50 p-12 text-center">
          <p className="text-[0.9375rem] font-medium text-foreground">
            No properties are open right now
          </p>
          <p className="mt-1.5 text-[0.875rem] text-muted-foreground">
            New listings are added regularly. Check back shortly.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {list.items.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>

          <p className="mt-8 text-center text-[0.75rem] leading-relaxed text-muted-foreground">
            Returns shown are the declared rate for each property over its stated term.
            Property investment carries risk; past performance does not guarantee future
            returns.
          </p>
        </>
      )}
    </div>
  );
}
