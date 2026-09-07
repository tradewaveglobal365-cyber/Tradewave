import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MapPin, TrendingUp, Calendar, Wallet as WalletIcon } from 'lucide-react';
import { getProperty } from '@/lib/properties';
import {
  formatBps,
  formatAedWhole,
  formatAedCompact,
  formatTerm,
} from '@/lib/money';
import { FundingBar } from '@/components/properties/funding-bar';
import { InvestPanel } from '@/components/invest/invest-panel';
import { getWallet } from '@/lib/wallet';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const property = await getProperty(slug);
  return { title: property ? `${property.title} · Tradewave` : 'Property · Tradewave' };
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [property, wallet] = await Promise.all([getProperty(slug), getWallet()]);
  if (!property) notFound();

  const isOpen = property.status === 'OPEN';

  return (
    <div>
      <Link
        href="/properties"
        className="mb-5 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All properties
      </Link>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        {/* ── Left: the property itself ─────────────────────────────────── */}
        <div>
          <div className="overflow-hidden rounded-xl border border-hairline bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={property.images[0]}
              alt={property.title}
              className="aspect-[16/9] w-full object-cover"
            />
          </div>

          <h1 className="mt-6 text-[1.75rem] leading-tight font-semibold tracking-[-0.025em] text-foreground">
            {property.title}
          </h1>
          <p className="mt-1.5 flex items-center gap-1.5 text-[0.875rem] text-muted-foreground">
            <MapPin className="size-3.5" />
            {property.addressLine} &middot; {property.area}, {property.city}
          </p>

          <p className="mt-5 text-[0.9375rem] leading-relaxed text-muted-foreground">
            {property.description}
          </p>

          <div className="mt-7 grid gap-4 sm:grid-cols-3">
            <Metric
              icon={<TrendingUp className="size-4" />}
              label="Annual return"
              value={formatBps(property.annualReturnBps)}
              tone="gain"
            />
            <Metric
              icon={<Calendar className="size-4" />}
              label="Term"
              value={formatTerm(property.termMonths)}
            />
            <Metric
              icon={<WalletIcon className="size-4" />}
              label="Minimum"
              value={formatAedCompact(property.minInvestmentFils)}
            />
          </div>
        </div>

        {/* ── Right: the money ───────────────────────────────────────────── */}
        <aside className="rounded-xl border border-hairline bg-surface p-6 lg:sticky lg:top-20">
          <p className="text-[0.75rem] font-medium text-muted-foreground">Property value</p>
          <p className="mt-1 text-[1.75rem] leading-none font-semibold tracking-[-0.02em] text-foreground">
            {formatAedWhole(property.totalValueFils)}
          </p>

          <div className="mt-5">
            <FundingBar property={property} />
          </div>

          <dl className="mt-6 space-y-2.5 border-t border-hairline pt-5 text-[0.8125rem]">
            <Row label="Minimum investment" value={formatAedWhole(property.minInvestmentFils)} />
            <Row label="Declared return" value={`${formatBps(property.annualReturnBps)} per year`} />
            <Row label="Term" value={formatTerm(property.termMonths)} />
          </dl>

          <div className="mt-6 border-t border-hairline pt-6">
            {isOpen ? (
              <InvestPanel property={property} walletBalanceFils={wallet?.balanceFils ?? '0'} />
            ) : (
              <div className="rounded-lg bg-gold-100 px-4 py-3.5 text-center">
                <p className="text-[0.8125rem] font-medium text-brand-900">
                  This property is fully funded
                </p>
              </div>
            )}
          </div>

          <p className="mt-4 text-[0.6875rem] leading-relaxed text-muted-foreground">
            Property investment carries risk. Returns are the declared rate for this
            property over its stated term and are not guaranteed.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'gain';
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[0.75rem] font-medium">{label}</span>
      </div>
      <p
        className={`mt-2 text-[1.25rem] leading-none font-semibold ${
          tone === 'gain' ? 'text-gain' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'gain' }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-semibold ${tone === 'gain' ? 'text-gain' : 'text-foreground'}`}>
        {value}
      </dd>
    </div>
  );
}
