import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { BadgeCheck, Banknote, ChevronRight, KeyRound, Landmark, ShieldCheck } from 'lucide-react';
import { getCurrentUser } from '@/lib/session';
import { PageHeader } from '@/components/dashboard/page-header';
import { SignOutAllButton } from '@/components/dashboard/sign-out-all-button';
import { ProfileForm } from '@/components/settings/profile-form';
import { PasswordForm } from '@/components/settings/password-form';
import { getPayoutAccount } from '@/lib/wallet';

export const metadata: Metadata = { title: 'Settings · Tradewave' };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/settings');

  // Only the account itself is needed here now. The bank list is fetched by
  // /settings/payout-account, which is the only page that renders the form —
  // so loading Settings no longer waits on a call to Klasha it cannot use.
  const account = await getPayoutAccount();

  return (
    <div>
      <PageHeader title="Settings" description="Your profile, security and payout details." />

      <div className="space-y-5">
        <Card
          title="Profile"
          description="Your name must match the document you verify with."
        >
          <ProfileForm user={user} />
        </Card>

        <Card
          title="Password"
          icon={<KeyRound className="size-4" />}
          description="Changing it signs out every other device."
        >
          <PasswordForm />
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

        {/* A summary that links out, not the form itself. Settings is a page
            you scan; adding a payout account is a task you arrive at with
            intent, and it now has its own screen rather than sitting three
            cards down this one. */}
        <Card
          title="Payout account"
          icon={<Banknote className="size-4" />}
          description="Where your returns and withdrawals are sent."
        >
          <Link
            href="/settings/payout-account"
            className="group flex items-center gap-3 rounded-lg border border-hairline bg-canvas px-4 py-3.5 transition-colors hover:border-brand-700/40 hover:bg-brand-100/30"
          >
            <Landmark className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              {account ? (
                <>
                  <p className="truncate text-[0.875rem] font-medium text-foreground">
                    {account.bankName}
                  </p>
                  <p className="mt-0.5 font-mono text-[0.75rem] tracking-[0.04em] text-muted-foreground tabular-nums">
                    {account.accountNumberMasked}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[0.875rem] font-medium text-foreground">
                    Add a payout account
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
                    {user.kycStatus === 'VERIFIED'
                      ? 'Takes about a minute.'
                      : 'Available once your identity is verified.'}
                  </p>
                </>
              )}
            </div>
            <span className="shrink-0 text-[0.8125rem] font-medium text-brand-700">
              {account ? 'Manage' : 'Add'}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
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
