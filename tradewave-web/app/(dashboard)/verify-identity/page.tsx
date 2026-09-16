import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Clock, ShieldAlert, ShieldCheck } from 'lucide-react';
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

  // Nobody who has already verified should ever see this page. It exists to
  // ask for something; once it has been given there is nothing here but a
  // status, and a status belongs in Settings. Someone finishing verification
  // lands on Settings with the Identity card already reading "Identity
  // verified", which is the confirmation they came back for.
  if (status === 'VERIFIED') redirect('/settings');

  // "In Review" is the provider saying a human has to look at this; "In
  // Progress" is the user not having finished. Both are PENDING to us and they
  // mean opposite things, so the copy must not guess between them.
  const underReview = kyc?.providerStatus === 'In Review';
  const waitedFor = relativeSince(kyc?.submittedAt ?? null);

  return (
    <div>
      {/* Follows the status. A verified user never reaches this page at all. */}
      <PageHeader
        title="Verify your identity"
        description={
          status === 'PENDING'
            ? 'Your details are with our verification partner.'
            : 'Required before you can invest. Photograph an ID, take a selfie — about a minute.'
        }
      />

      <div className="max-w-xl">
        {/* No VERIFIED branch: that status redirects to Settings above, so
            rendering one here would be a state this page can never reach. */}
        {status === 'PENDING' ? (
          <Panel
            tone="wait"
            icon={Clock}
            title={
              underReview
                ? 'A person is checking your document'
                : "We're reviewing your details"
            }
            body={
              underReview
                ? `Most checks finish within a day. Submitted ${waitedFor}. We'll email you as soon as it is decided — you don't have to wait on this page.`
                : kyc?.documentLast4
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

            {/* The escape hatch, offered only once a review has dragged on.
                Somebody whose document is sitting in a queue has no way forward
                and no way back, and "wait" stops being an answer you can give a
                person after two days. */}
            {kyc?.stalled ? (
              <div className="mt-5 border-t border-hairline pt-5">
                <p className="mb-3 text-[0.8125rem] leading-relaxed text-muted-foreground">
                  This is taking longer than it should. You can start a new check with a
                  different document rather than keep waiting — the one in progress
                  will be set aside.
                </p>
                <VerifyIdentityForm
                  user={user}
                  attemptsRemaining={kyc.attemptsRemaining}
                />
              </div>
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

/** "3 days ago" — plain enough that nobody has to work out what it means. */
function relativeSince(iso: string | null): string {
  if (!iso) return 'recently';
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
