'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle, Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, errorMessage } from '@/lib/api';
import type { MessageResponse, SessionResponse } from '@/lib/types';

type State =
  | { kind: 'verifying' }
  | { kind: 'success'; firstName: string }
  | { kind: 'error'; message: string }
  | { kind: 'resend'; email: string };

export function VerifyEmailClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const resendEmail = searchParams.get('resend');

  const [state, setState] = useState<State>(
    token ? { kind: 'verifying' } : { kind: 'resend', email: resendEmail ?? '' },
  );
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  // React 18+ StrictMode double-invokes effects in dev. Verification consumes a
  // single-use token, so without this guard the second call always reports
  // "already used" and the happy path looks broken in development.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    apiFetch<SessionResponse>('/auth/verify-email', { method: 'POST', body: { token } })
      .then((res) => {
        setState({ kind: 'success', firstName: res.user.firstName });
        // Verification signs the user in, so go straight to the dashboard.
        setTimeout(() => {
          window.location.href = '/dashboard';
        }, 1400);
      })
      .catch((err: unknown) => setState({ kind: 'error', message: errorMessage(err) }));
  }, [token]);

  async function handleResend(email: string) {
    setResending(true);
    try {
      await apiFetch<MessageResponse>('/auth/resend-verification', {
        method: 'POST',
        body: { email },
      });
      setResent(true);
    } catch {
      // The endpoint is intentionally non-revealing; show the same result either way.
      setResent(true);
    } finally {
      setResending(false);
    }
  }

  if (state.kind === 'verifying') {
    return (
      <Panel
        icon={<Loader2 className="size-5 animate-spin text-brand-700" />}
        title="Verifying your email"
        body="This will only take a moment."
      />
    );
  }

  if (state.kind === 'success') {
    return (
      <Panel
        icon={<CheckCircle2 className="size-5 text-gain" />}
        title={`You're verified, ${state.firstName}`}
        body="Taking you to your dashboard…"
      />
    );
  }

  if (state.kind === 'error') {
    return (
      <Panel icon={<XCircle className="size-5 text-destructive" />} title="Link didn't work" body={state.message}>
        <ResendBlock
          email={resendEmail ?? ''}
          resending={resending}
          resent={resent}
          onResend={handleResend}
        />
      </Panel>
    );
  }

  return (
    <Panel
      icon={<MailCheck className="size-5 text-brand-700" />}
      title="Resend verification link"
      body="Enter the email you signed up with and we'll send a fresh link."
    >
      <ResendBlock
        email={state.email}
        resending={resending}
        resent={resent}
        onResend={handleResend}
      />
    </Panel>
  );
}

function ResendBlock({
  email,
  resending,
  resent,
  onResend,
}: {
  email: string;
  resending: boolean;
  resent: boolean;
  onResend: (email: string) => void;
}) {
  const [value, setValue] = useState(email);

  if (resent) {
    return (
      <p className="mt-5 rounded-lg border border-brand-200 bg-brand-50 px-3.5 py-3 text-[0.8125rem] leading-snug text-brand-900">
        If that account still needs verifying, a new link is on its way. It expires in 24 hours.
      </p>
    );
  }

  return (
    <form
      className="mt-5 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onResend(value.trim());
      }}
    >
      <input
        type="email"
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="you@example.com"
        aria-label="Email address"
        className="h-11 w-full rounded-md border border-input bg-surface px-3 text-base md:h-9 md:text-[0.875rem] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <Button type="submit" disabled={resending} className="h-11 w-full md:h-9">
        {resending ? 'Sending…' : 'Send new link'}
      </Button>
      <p className="text-center text-[0.8125rem] text-muted-foreground">
        <Link href="/login" className="font-medium text-brand-700 underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

function Panel({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-6 text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-100">
        {icon}
      </div>
      <h1 className="mt-4 text-[1.0625rem] font-semibold text-foreground">{title}</h1>
      <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}
