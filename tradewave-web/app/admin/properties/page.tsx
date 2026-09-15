import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';
import { getAdminProperties, type AdminProperty } from '@/lib/admin';
import { ADMIN_NAV_ITEMS } from '@/lib/admin-nav';
import { formatBps, formatUsd, formatUsdCompact } from '@/lib/money';

export const metadata: Metadata = { title: 'Properties · Admin' };

export default async function AdminPropertiesPage() {
  const properties = await getAdminProperties();
  const drafts = properties.filter((p) => p.status === 'DRAFT').length;
  const description = ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/properties')?.description;

  return (
    <div>
      <PageHeader
        title="Properties"
        description={description}
        action={
          <Button asChild className="h-10 gap-1.5">
            <Link href="/admin/properties/new">
              <Plus className="size-4" />
              New listing
            </Link>
          </Button>
        }
      />

      {drafts > 0 ? (
        <div className="mb-5 rounded-xl border border-hairline bg-surface px-4 py-3">
          <p className="text-[0.8125rem] text-muted-foreground">
            <span className="font-medium text-foreground">
              {drafts} draft{drafts === 1 ? '' : 's'}
            </span>{' '}
            — not visible to investors until published.
          </p>
        </div>
      ) : null}

      {properties.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-5" />}
          title="No listings yet"
          description="Create one, add photographs, then publish it for investors."
          action={
            <Button asChild className="h-10 gap-1.5">
              <Link href="/admin/properties/new">
                <Plus className="size-4" />
                New listing
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Cards below md, table above — same split as Deposits. */}
          <ul className="space-y-3 md:hidden">
            {properties.map((p) => (
              <PropertyCard key={p.id} property={p} />
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border border-hairline bg-surface md:block">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-hairline text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
                  <th className="px-4 py-2.5">Listing</th>
                  <th className="px-4 py-2.5 text-right">Value</th>
                  <th className="px-4 py-2.5 text-right">Return</th>
                  <th className="px-4 py-2.5">Funding</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => (
                  <PropertyRow key={p.id} property={p} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PropertyCard({ property: p }: { property: AdminProperty }) {
  return (
    <li className="overflow-hidden rounded-xl border border-hairline bg-surface">
      <Link href={`/admin/properties/${p.id}`} className="block">
        <div className="flex gap-3 p-4">
          <Thumb property={p} className="size-16 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-[0.875rem] font-medium text-foreground">{p.title}</p>
              <StatusPill status={p.status} />
            </div>
            <p className="mt-0.5 truncate text-[0.75rem] text-muted-foreground">
              {p.area}, {p.city}
            </p>
            <p className="mt-1.5 text-[0.8125rem] tabular-nums text-foreground">
              {formatUsdCompact(p.totalValueCents)}
              <span className="ml-2 text-muted-foreground">
                {formatBps(p.annualReturnBps)} · {p.termMonths}mo
              </span>
            </p>
          </div>
        </div>
        <div className="border-t border-hairline px-4 py-2.5">
          <FundingBar property={p} />
        </div>
      </Link>
    </li>
  );
}

function PropertyRow({ property: p }: { property: AdminProperty }) {
  return (
    <tr className="border-b border-hairline last:border-b-0 hover:bg-canvas">
      <td className="px-4 py-3">
        <Link href={`/admin/properties/${p.id}`} className="flex items-center gap-3">
          <Thumb property={p} className="size-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] font-medium text-foreground">{p.title}</p>
            <p className="mt-0.5 truncate text-[0.75rem] text-muted-foreground">
              {p.area}, {p.city}
            </p>
          </div>
        </Link>
      </td>
      <td className="px-4 py-3 text-right text-[0.8125rem] tabular-nums text-foreground">
        {formatUsd(p.totalValueCents)}
      </td>
      <td className="px-4 py-3 text-right text-[0.8125rem] tabular-nums text-foreground">
        {formatBps(p.annualReturnBps)}
      </td>
      <td className="w-40 px-4 py-3">
        <FundingBar property={p} />
      </td>
      <td className="px-4 py-3">
        <StatusPill status={p.status} />
      </td>
    </tr>
  );
}

function Thumb({ property: p, className }: { property: AdminProperty; className: string }) {
  return (
    <div className={`overflow-hidden rounded-lg bg-muted ${className}`}>
      {p.images[0] ? (
        // Plain img, matching components/properties/property-card.tsx.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.images[0]} alt="" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center">
          <Building2 className="size-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function FundingBar({ property: p }: { property: AdminProperty }) {
  const pct = Math.round(p.fundedProgress * 100);
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-brand-700" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">
        {pct}% · {p.investorCount} investor{p.investorCount === 1 ? '' : 's'}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: AdminProperty['status'] }) {
  const tone =
    status === 'OPEN'
      ? 'bg-gain/10 text-gain'
      : status === 'DRAFT'
        ? 'bg-pending/15 text-pending'
        : 'bg-muted text-muted-foreground';
  const label = status.charAt(0) + status.slice(1).toLowerCase();

  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}
