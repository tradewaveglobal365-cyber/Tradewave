import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { BadgeCheck, Banknote, ShieldCheck } from 'lucide-react';
import { getCurrentUser } from '@/lib/session';
import { PageHeader } from '@/components/dashboard/page-header';
import { SignOutAllButton } from '@/components/dashboard/sign-out-all-button';

export const metadata: Metadata = { title: 'Settings · Tradewave' };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/settings');

  return (
    <div>
      <PageHeader title="Settings" description="Your profile, security and payout details." />

      <div className="space-y-5">
        <Card title="Profile">
          <dl className="space-y-3 text-[0.875rem]">
            <Row label="Name" value={`${user.firstName} ${user.lastName}`} />
            <Row label="Email" value={user.email} />
            <Row label="Phone" value={user.phone ?? 'Not provided'} muted={!user.phone} />
            <Row label="Country" value={user.country} />
          </dl>
        </Card>

        <Card
          title="Identity verification"
          icon={<BadgeCheck className="size-4" />}
          description="Required before you can invest."
        >
          <StatusRow
            done={user.emailVerified}
            doneLabel="Email verified"
            todoLabel="Email not verified"
          />
          {/* kycStatus is its own field, not a UserStatus case: a user can be
              ACTIVE and unverified at once, and verifyEmail/resetPassword both
              write status:'ACTIVE' as a side effect. */}
          <StatusRow
            done={user.kycStatus === 'VERIFIED'}
            doneLabel="Identity verified"
            todoLabel={
              user.kycStatus === 'PENDING'
                ? 'Identity under review'
                : 'Identity not verified'
            }
          />
          {user.kycStatus !== 'VERIFIED' ? (
            <p className="mt-3 text-[0.8125rem] text-muted-foreground">
              <Link
                href="/verify-identity"
                className="font-medium text-brand-700 underline-offset-4 hover:underline"
              >
                {user.kycStatus === 'PENDING'
                  ? 'Check verification status'
                  : user.kycStatus === 'NOT_STARTED'
                    ? 'Verify your identity'
                    : 'Try verifying again'}
              </Link>{' '}
              to unlock investing.
            </p>
          ) : null}
        </Card>

        <Card
          title="Payout account"
          icon={<Banknote className="size-4" />}
          description="Where your returns and withdrawals are sent."
        >
          <p className="rounded-lg border border-dashed border-hairline bg-canvas px-3.5 py-3 text-[0.75rem] leading-relaxed text-muted-foreground">
            No payout account added. This unlocks alongside withdrawals.
          </p>
        </Card>

        <Card
          title="Security"
          icon={<ShieldCheck className="size-4" />}
          description="Sign out everywhere if you think someone else has access."
        >
          <SignOutAllButton />
        </Card>
      </div>
    </div>
  );
}

function Card({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-[1rem] font-semibold text-foreground">
          {icon}
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={muted ? 'text-muted-foreground' : 'font-medium text-foreground'}>{value}</dd>
    </div>
  );
}

function StatusRow({
  done,
  doneLabel,
  todoLabel,
}: {
  done: boolean;
  doneLabel: string;
  todoLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1 text-[0.875rem]">
      <span
        className={`size-1.5 shrink-0 rounded-full ${done ? 'bg-gain' : 'bg-pending'}`}
        aria-hidden="true"
      />
      <span className={done ? 'text-foreground' : 'text-muted-foreground'}>
        {done ? doneLabel : todoLabel}
      </span>
    </div>
  );
}
