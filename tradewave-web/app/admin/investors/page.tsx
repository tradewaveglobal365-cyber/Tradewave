import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle, ChevronLeft, ChevronRight, Search, Users } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';
import { getAdminInvestors, type AdminInvestorRow } from '@/lib/admin';
import { ADMIN_NAV_ITEMS } from '@/lib/admin-nav';
import { formatUsd } from '@/lib/money';
import { KycPill, StatusDot } from '@/components/admin/investor-pills';

export const metadata: Metadata = { title: 'Investors \u00b7 Admin' };

/**
 * Everyone who has signed up.
 *
 * Search and paging are query-string driven and the form is a plain GET, so
 * this whole screen stays a server component \u2014 no client bundle for what is
 * fundamentally a list, and a search result is a URL somebody can send to a
 * colleague.
 */
export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() || undefined;
  const page = Number(params.page) > 0 ? Math.floor(Number(params.page)) : 1;

  const data = await getAdminInvestors({ q, page });
  const description = ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/investors')?.description;

  if (!data) {
    return (
      <div>
        <PageHeader title="Investors" description={description} />
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3.5 text-[0.8125rem] text-destructive"
        >
          <AlertCircle className="mt-px size-4 shrink-0" />
          <span>We could not load the investor list. Reload the page to try again.</span>
        </div>
      </div>
    );
  }

  const { investors, total, pageSize } = data;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div>
      <PageHeader title="Investors" description={description} />

      <form className="mb-5 flex gap-2" action="/admin/investors">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search by name or email"
            aria-label="Search investors by name or email"
            className="h-11 w-full rounded-lg border border-input bg-surface pr-3 pl-9 text-[0.875rem] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 md:h-10"
          />
        </div>
        <button
          type="submit"
          className="h-11 shrink-0 rounded-lg bg-brand-700 px-4 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none md:h-10"
        >
          Search
        </button>
      </form>

      {investors.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title={q ? `Nobody matches \u201c${q}\u201d` : 'No investors yet'}
          description={
            q
              ? 'Try a different name or email, or clear the search to see everyone.'
              : 'Anyone who signs up will appear here, along with how far through setup they have got.'
          }
          action={
            q ? (
              <Link
                href="/admin/investors"
                className="text-[0.875rem] font-medium text-brand-700 underline-offset-4 hover:underline"
              >
                Clear search
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Cards below md \u2014 a seven-column table on a phone is either
              unreadable or a horizontal scroll nobody finds. */}
          <ul className="space-y-3 md:hidden">
            {investors.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/admin/investors/${i.id}`}
                  className="block rounded-xl border border-hairline bg-surface p-4 transition-colors hover:border-brand-700/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[0.875rem] font-medium text-foreground">
                        {i.firstName} {i.lastName}
                      </p>
                      <p className="mt-0.5 truncate text-[0.75rem] text-muted-foreground">
                        {i.email}
                      </p>
                    </div>
                    <KycPill status={i.kycStatus} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-hairline pt-3">
                    <Cell label="Wallet" value={formatUsd(i.balanceCents)} />
                    <Cell label="Invested" value={formatUsd(i.investedCents)} />
                  </dl>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border border-hairline bg-surface md:block">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-hairline text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
                  <th className="px-4 py-2.5">Investor</th>
                  <th className="px-4 py-2.5">Identity</th>
                  <th className="px-4 py-2.5 text-right">Wallet</th>
                  <th className="px-4 py-2.5 text-right">Invested</th>
                  <th className="px-4 py-2.5 text-right">Payout</th>
                  <th className="px-4 py-2.5">Joined</th>
                </tr>
              </thead>
              <tbody>
                {investors.map((i) => (
                  <Row key={i.id} investor={i} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.75rem] text-muted-foreground tabular-nums">
              {from}\u2013{to} of {total}
            </p>
            {lastPage > 1 ? (
              <div className="flex items-center gap-2">
                <PageLink q={q} page={page - 1} disabled={page <= 1} label="Previous">
                  <ChevronLeft className="size-4" />
                </PageLink>
                <span className="text-[0.75rem] text-muted-foreground tabular-nums">
                  {page} of {lastPage}
                </span>
                <PageLink q={q} page={page + 1} disabled={page >= lastPage} label="Next">
                  <ChevronRight className="size-4" />
                </PageLink>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ investor: i }: { investor: AdminInvestorRow }) {
  return (
    <tr className="border-b border-hairline last:border-b-0 hover:bg-canvas/60">
      <td className="px-4 py-3">
        <Link href={`/admin/investors/${i.id}`} className="group block">
          <span className="flex items-center gap-2">
            <StatusDot status={i.status} />
            <span className="text-[0.8125rem] font-medium text-foreground group-hover:underline">
              {i.firstName} {i.lastName}
            </span>
            {i.role === 'ADMIN' ? (
              <span className="rounded-full bg-brand-100 px-1.5 py-px text-[0.625rem] font-medium text-brand-700">
                Staff
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-[0.75rem] text-muted-foreground">{i.email}</span>
        </Link>
      </td>
      <td className="px-4 py-3">
        <KycPill status={i.kycStatus} />
      </td>
      <td className="px-4 py-3 text-right text-[0.8125rem] tabular-nums text-foreground">
        {formatUsd(i.balanceCents)}
      </td>
      <td className="px-4 py-3 text-right text-[0.8125rem] tabular-nums text-foreground">
        {formatUsd(i.investedCents)}
        {i.investmentCount > 0 ? (
          <span className="block text-[0.6875rem] text-muted-foreground">
            {i.investmentCount} holding{i.investmentCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right text-[0.75rem] text-muted-foreground">
        {i.hasPayoutAccount ? 'Added' : '\u2014'}
      </td>
      <td className="px-4 py-3 text-[0.75rem] text-muted-foreground">
        {new Date(i.createdAt).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </td>
    </tr>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[0.8125rem] font-medium tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

/** Paging that keeps the search term, so page two of a search is still that search. */
function PageLink({
  q,
  page,
  disabled,
  label,
  children,
}: {
  q?: string;
  page: number;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const search = new URLSearchParams();
  if (q) search.set('q', q);
  if (page > 1) search.set('page', String(page));
  const qs = search.toString();

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className="flex size-9 items-center justify-center rounded-lg border border-hairline text-muted-foreground/40"
      >
        {children}
      </span>
    );
  }

  return (
    <Link
      href={`/admin/investors${qs ? `?${qs}` : ''}`}
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-lg border border-hairline text-foreground transition-colors hover:border-brand-700/40 hover:bg-canvas"
    >
      {children}
    </Link>
  );
}
