import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BadgeCheck, Landmark, Wallet } from 'lucide-react';
import { getAdminInvestor } from '@/lib/admin';
import { formatUsd } from '@/lib/money';
import { KycPill } from '@/components/admin/investor-pills';

export const metadata: Metadata = { title: 'Investor · Admin' };

const ENTRY_LABELS: Record<string, string> = {
  DEPOSIT: 'Wallet funding',
  INVESTMENT: 'Investment',
  RETURN_PAYOUT: 'Return payout',
  REFERRAL_BONUS: 'Referral bonus',
  WITHDRAWAL: 'Withdrawal',
  ADJUSTMENT: 'Adjustment',
};

function date(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * One investor, everything about them on one screen.
 *
 * Read-only. Suspending an account, forcing a KYC recheck and adjusting a
 * balance are all real needs and all of them are decisions about money or
 * access — they deserve their own design rather than a button added to a
 * detail page because there was room for one.
 */
export default async function InvestorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const investor = await getAdminInvestor(id);
  if (!investor) notFound();

  return (
    <div>
      <Link
        href="/admin/investors"
        className="mb-5 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Investors
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.625rem] font-semibold tracking-[-0.025em] text-foreground">
            {investor.firstName} {investor.lastName}
          </h1>
          <p className="mt-1 text-[0.9375rem] break-all text-muted-foreground">
            {investor.email}
          </p>
        </div>
        <KycPill status={investor.kycStatus} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Wallet" icon={<Wallet className="size-4" />}>
            <p className="text-[1.75rem] leading-none font-semibold tracking-[-0.02em] tabular-nums text-foreground">
              {formatUsd(investor.balanceCents)}
            </p>
            {investor.entries.length === 0 ? (
              <p className="mt-4 text-[0.8125rem] text-muted-foreground">
                No ledger entries yet.
              </p>
            ) : (
              <ul className="mt-4 overflow-hidden rounded-lg border border-hairline">
                {investor.entries.map((e) => {
                  const credit = !e.amountCents.startsWith('-');
                  return (
                    <li
                      key={e.id}
                      className="flex items-center justify-between gap-4 border-b border-hairline bg-canvas px-3.5 py-2.5 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[0.8125rem] text-foreground">
                          {e.description || ENTRY_LABELS[e.type] || e.type}
                        </p>
                        <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                          {date(e.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-[0.8125rem] font-medium tabular-nums ${
                            credit ? 'text-gain' : 'text-foreground'
                          }`}
                        >
                          {credit ? '+' : '−'}
                          {formatUsd(e.amountCents.replace('-', ''))}
                        </p>
                        <p className="mt-0.5 text-[0.6875rem] text-muted-foreground tabular-nums">
                          {formatUsd(e.balanceAfterCents)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Investments">
            {investor.investments.length === 0 ? (
              <p className="text-[0.8125rem] text-muted-foreground">
                Nothing invested yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {investor.investments.map((inv) => (
                  <li
                    key={inv.id}
                    className="rounded-lg border border-hairline bg-canvas px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-[0.8125rem] font-medium text-foreground">
                        {inv.propertyTitle}
                      </p>
                      <p className="text-[0.8125rem] font-medium tabular-nums text-foreground">
                        {formatUsd(inv.principalCents)}
                      </p>
                    </div>
                    <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                      {(inv.annualReturnBps / 100).toFixed(2)}% a year over {inv.termMonths}{' '}
                      months · {inv.status.toLowerCase()} · matures {date(inv.maturesAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Account">
            <Row label="Status" value={investor.status.toLowerCase().replace(/_/g, ' ')} />
            <Row label="Email verified" value={investor.emailVerified ? 'Yes' : 'No'} />
            <Row label="Phone" value={investor.phone ?? '—'} />
            <Row label="Country" value={investor.country} />
            <Row label="Joined" value={date(investor.createdAt)} />
            <Row label="Last signed in" value={date(investor.lastLoginAt)} />
            {investor.role === 'ADMIN' ? <Row label="Role" value="Staff" /> : null}
          </Card>

          <Card title="Identity" icon={<BadgeCheck className="size-4" />}>
            {investor.kyc ? (
              <>
                <Row label="Decision" value={investor.kyc.status.toLowerCase()} />
                <Row label="Provider" value={investor.kyc.provider} />
                <Row
                  label="Document"
                  value={
                    investor.kyc.documentLast4
                      ? `${investor.kyc.documentType ?? 'Document'} ••••${investor.kyc.documentLast4}`
                      : '—'
                  }
                />
                <Row label="Submitted" value={date(investor.kyc.submittedAt)} />
                <Row label="Decided" value={date(investor.kyc.decidedAt)} />
                {investor.kyc.rejectionReason ? (
                  <p className="mt-2 rounded-lg bg-destructive/5 px-3 py-2 text-[0.75rem] leading-relaxed text-destructive">
                    {investor.kyc.rejectionReason}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">
                No verification attempted.
              </p>
            )}
          </Card>

          <Card title="Payout account" icon={<Landmark className="size-4" />}>
            {investor.payoutAccount ? (
              <>
                <Row label="Bank" value={investor.payoutAccount.bankName} />
                {/* Masked for staff too. Reading a full account number off a
                    screen is not part of any workflow this page supports, and
                    it is the field an attacker would change to redirect money. */}
                <Row label="Number" value={investor.payoutAccount.accountNumberMasked} />
                <Row label="Name" value={investor.payoutAccount.accountName} />
                <Row
                  label="Name checked"
                  value={
                    investor.payoutAccount.nameResolved
                      ? 'Confirmed with the bank'
                      : 'Self-asserted only'
                  }
                />
              </>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">Not added yet.</p>
            )}
          </Card>

          <Card title="Funding account">
            {investor.depositAccount ? (
              <>
                <Row label="Bank" value={investor.depositAccount.bankName} />
                <Row label="Number" value={investor.depositAccount.accountNumber} />
                <Row label="Name" value={investor.depositAccount.accountName} />
              </>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">
                Not issued — it is created the first time they open the wallet after
                verifying.
              </p>
            )}
          </Card>

          <Card title="Referrals">
            <Row label="Their code" value={investor.referralCode} />
            <Row label="People referred" value={String(investor.referralCount)} />
            <Row
              label="Referred by"
              value={
                investor.referredBy
                  ? `${investor.referredBy.firstName} ${investor.referredBy.lastName}`
                  : '—'
              }
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[0.9375rem] font-semibold text-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-2 last:border-b-0">
      <span className="shrink-0 text-[0.75rem] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-[0.8125rem] break-words text-foreground capitalize">
        {value}
      </span>
    </div>
  );
}
