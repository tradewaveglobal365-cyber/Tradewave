import type { Metadata } from 'next';
import { getReferralList, getReferralSummary } from '@/lib/referrals';
import { CopyLink } from '@/components/dashboard/copy-link';

export const metadata: Metadata = { title: 'Referrals · Tradewave' };

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  ACTIVE: { text: 'Verified', className: 'bg-gain/10 text-gain' },
  PENDING_VERIFICATION: { text: 'Pending', className: 'bg-pending/10 text-pending' },
  SUSPENDED: { text: 'Suspended', className: 'bg-destructive/10 text-destructive' },
};

export default async function ReferralsPage() {
  const [summary, list] = await Promise.all([getReferralSummary(), getReferralList()]);

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-[1.625rem] font-semibold tracking-[-0.025em] text-foreground">
          Referrals
        </h1>
        <p className="mt-1 text-[0.9375rem] text-muted-foreground">
          Invite people to Tradewave with your personal link.
        </p>
      </header>

      <section className="rounded-xl border border-hairline bg-surface p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-[0.8125rem] font-medium text-muted-foreground">Your referral code</p>
            <p className="mt-1 font-mono text-[1.5rem] font-semibold tracking-[0.12em] text-brand-900">
              {summary?.code ?? '—'}
            </p>
          </div>
          <div className="flex gap-6">
            <Stat label="Invited" value={summary?.totalReferrals ?? 0} />
            <Stat label="Verified" value={summary?.verifiedReferrals ?? 0} />
          </div>
        </div>

        {summary?.shareUrl ? <CopyLink url={summary.shareUrl} /> : null}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-[1rem] font-semibold text-foreground">People you&rsquo;ve invited</h2>

        {!list || list.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-hairline bg-surface/50 p-10 text-center">
            <p className="text-[0.875rem] text-muted-foreground">
              No one has joined with your link yet.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
            {/* Wide content scrolls inside its own container rather than the page. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-[0.875rem]">
                <thead className="border-b border-hairline bg-muted/40 text-[0.75rem] tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">Name</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Email</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Status</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((item, i) => {
                    const status = STATUS_LABEL[item.status] ?? STATUS_LABEL.PENDING_VERIFICATION!;
                    return (
                      <tr
                        key={`${item.maskedEmail}-${i}`}
                        className="border-b border-hairline last:border-0"
                      >
                        <td className="px-5 py-3 font-medium text-foreground">{item.displayName}</td>
                        <td className="px-5 py-3 font-mono text-[0.8125rem] text-muted-foreground">
                          {item.maskedEmail}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[0.75rem] font-medium ${status.className}`}
                          >
                            {status.text}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground tabular-nums">
                          {new Date(item.joinedAt).toLocaleDateString('en-AE', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[0.75rem] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[1.25rem] font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
