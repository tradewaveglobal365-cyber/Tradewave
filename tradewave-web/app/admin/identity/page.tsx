import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/dashboard/page-header';
import { getPendingReviews, type AdminReviewRow } from '@/lib/admin';
import { ADMIN_NAV_ITEMS } from '@/lib/admin-nav';

export const metadata: Metadata = { title: 'Identity · Admin' };

/** Where a reviewer actually decides. The document scan never reaches our server. */
const CONSOLE = 'https://business.didit.me';

/**
 * Verifications waiting on a person.
 *
 * Didit escalates a document it is not sure about to a human reviewer, and that
 * human is us. Nothing ever said so — an investor waited three days and we only
 * learned of it because he got in touch. The queue was always there; there was
 * no window onto it.
 */
export default async function IdentityPage() {
  const reviews = await getPendingReviews();
  const description = ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/identity')?.description;
  const stale = reviews.filter((r) => r.waitingHours >= 48);

  return (
    <div>
      <PageHeader title="Identity" description={description} />

      {stale.length > 0 ? (
        <div className="mb-5 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-[0.8125rem] font-medium text-foreground">
            {stale.length} waiting more than two days
          </p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">
            Past 48 hours these investors can abandon the attempt and start again, which
            costs another check and leaves this session still needing a decision.
          </p>
        </div>
      ) : null}

      {reviews.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-5" />}
          title="Nothing waiting on us"
          description="When the provider cannot decide on a document by itself it sends it here for a person to approve or decline."
        />
      ) : (
        <>
          <ul className="space-y-3">
            {reviews.map((r) => (
              <ReviewCard key={r.verificationId} review={r} />
            ))}
          </ul>

          <p className="mt-5 text-[0.75rem] leading-relaxed text-muted-foreground">
            Decisions are made in the Didit console, which holds the document scan and the
            selfie — those never reach Tradewave&rsquo;s servers, which is why this page can
            show you who is waiting but not what they submitted.
          </p>
        </>
      )}
    </div>
  );
}

function ReviewCard({ review: r }: { review: AdminReviewRow }) {
  const days = Math.floor(r.waitingHours / 24);
  const waited =
    r.waitingHours < 1
      ? 'less than an hour'
      : r.waitingHours < 48
        ? `${r.waitingHours} hour${r.waitingHours === 1 ? '' : 's'}`
        : `${days} days`;

  return (
    <li className="rounded-xl border border-hairline bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/admin/investors/${r.user.id}`}
            className="text-[0.875rem] font-medium text-foreground hover:underline"
          >
            {r.user.firstName} {r.user.lastName}
          </Link>
          <p className="mt-0.5 truncate text-[0.75rem] text-muted-foreground">
            {r.user.email}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${
            r.waitingHours >= 48
              ? 'bg-destructive/10 text-destructive'
              : 'bg-pending/15 text-pending'
          }`}
        >
          Waiting {waited}
        </span>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline pt-3">
        <Stat label="Liveness" value={r.livenessScore} />
        <Stat label="Face match" value={r.faceMatchScore} />
        <div>
          <dt className="text-[0.6875rem] text-muted-foreground">Document</dt>
          <dd className="mt-0.5 text-[0.8125rem] font-medium text-foreground">
            {r.documentType ?? 'Not extracted'}
          </dd>
        </div>
      </dl>

      {/* Deep-linking to the session needs the provider ref; without one the
          reviewer still gets to the right place, just a search away. */}
      <a
        href={
          r.providerRef
            ? `${CONSOLE}/sessions/${encodeURIComponent(r.providerRef)}`
            : `${CONSOLE}/sessions`
        }
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Review in Didit
        <ExternalLink className="size-3.5" />
      </a>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-[0.6875rem] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[0.8125rem] font-medium tabular-nums text-foreground">
        {value === null ? '—' : value.toFixed(value % 1 === 0 ? 0 : 2)}
      </dd>
    </div>
  );
}
