import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BadgeCheck, Clock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { getCurrentUser } from '@/lib/session';
import { getKycStatus } from '@/lib/kyc';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { VerifyIdentityForm } from '@/components/kyc/verify-identity-form';
import { VerificationPoller } from '@/components/kyc/verification-poller';

export const metadata: Metadata = { title: 'Verify your identity · Tradewave' };

export default async function VerifyIdentityPage() {
  const [user, kyc] = await Promise.all([getCurrentUser(), getKycStatus()]);
  if (!user) redirect('/login?next=/verify-identity');

  // A null read means the API was unreachable, not that they are verified —
  // fall back to the most restrictive state.
  const status = kyc?.status ?? user.kycStatus ?? 'NOT_STARTED';

  return (
    <div>
      <PageHeader
        title="Verify your identity"
        description="Required before you can invest. Photograph an ID, take a selfie \u2014 about a minute."
      />

      <div className="max-w-xl">
        {status === 'VERIFIED' ? (
          <Panel
            tone="ok"
            icon={BadgeCheck}
            title="Your identity is verified"
            body={
              kyc?.documentLast4
                ? `Confirmed against the document ending ${kyc.documentLast4}.`
                : 'You can now invest in any open property.'
            }
          >
            <Button asChild className="h-11 md:h-10">
              <Link href="/properties">Browse properties</Link>
            </Button>
          </Panel>
        ) : status === 'PENDING' ? (
          <Panel
            tone="wait"
            icon={Clock}
            title="We're reviewing your details"
            body={
              kyc?.documentLast4
                ? `Document ending ${kyc.documentLast4}. This page updates itself — you don't have to wait here.`
                : 'This page updates itself as soon as the check completes.'
            }
          >
            <VerificationPoller />
            {kyc?.redirectUrl ? (
              <>
                <p className="mb-3 text-[0.8125rem] text-muted-foreground">
                  Didn&rsquo;t finish? You can pick up where you left off.
                </p>
                <Button asChild className="h-11 md:h-10">
                  <a href={kyc.redirectUrl}>Continue verification</a>
                </Button>
              </>
            ) : null}
          </Panel>
        ) : status === 'REJECTED' || status === 'EXPIRED' ? (
          <Panel
            tone="warn"
            icon={ShieldAlert}
            title={
              status === 'EXPIRED'
                ? 'That verification session expired'
                : "We couldn't verify that document"
            }
            body={
              status === 'EXPIRED'
                ? 'Nothing went wrong on your side — the check timed out before it finished. Please try again.'
                : (kyc?.reason ??
                  'Make sure the whole document is in frame, in focus and not expired, then try again.')
            }
          >
            {kyc?.canRetry ? (
              <div className="mt-5 border-t border-hairline pt-5">
                <VerifyIdentityForm
                  user={user}
                  attemptsRemaining={kyc.attemptsRemaining}
                />
              </div>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">
                You have used all your attempts. Contact support to continue.
              </p>
            )}
          </Panel>
        ) : (
          <div className="rounded-xl border border-hairline bg-surface p-6">
            <VerifyIdentityForm
              user={user}
              attemptsRemaining={kyc?.attemptsRemaining ?? 10}
            />
            <p className="mt-5 flex items-start gap-2 border-t border-hairline pt-4 text-[0.75rem] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-px size-3.5 shrink-0" />
              <span>
                Your document photo and selfie stay with our verification partner
                and never reach Tradewave. We keep the result, and a one-way
                fingerprint of the document number so one ID cannot open two
                accounts.
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Panel({
  tone,
  icon: Icon,
  title,
  body,
  children,
}: {
  tone: 'ok' | 'wait' | 'warn';
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  const ring =
    tone === 'ok'
      ? 'bg-brand-700/10 text-brand-700'
      : tone === 'warn'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-muted text-muted-foreground';

  return (
    <div className="rounded-xl border border-hairline bg-surface p-6">
      <div className={`flex size-10 items-center justify-center rounded-full ${ring}`}>
        <Icon className="size-5" />
      </div>
      <h2 className="mt-4 text-[1.0625rem] font-semibold text-foreground">{title}</h2>
      <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted-foreground">{body}</p>
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}
