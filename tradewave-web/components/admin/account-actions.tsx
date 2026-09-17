'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Ban, KeyRound, Lock, MailCheck, ShieldOff, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import type { AdminInvestorDetail } from '@/lib/admin';

/**
 * Doing things to an investor's account.
 *
 * Every action asks for a reason before it fires. There is no dialog primitive
 * in this codebase, so the reason field IS the confirmation step — and it has to
 * exist anyway, because a reason is recorded against every one of these and an
 * audit log full of blanks answers nothing when somebody asks why six months
 * later.
 *
 * Restrict and suspend are deliberately separate buttons rather than a dropdown.
 * They mean different things to the person on the other end — one can still sign
 * in and see their money, the other cannot get in at all — and picking the wrong
 * one from a list is easier than picking the wrong button.
 */
type Action =
  | 'restrict'
  | 'suspend'
  | 'reinstate'
  | 'unrestrict'
  | 'block'
  | 'unblock'
  | 'kyc-reset'
  | 'verify-email';

interface Control {
  action: Action;
  label: string;
  icon: React.ReactNode;
  /** Shown above the reason field, so the consequence is stated before typing. */
  consequence: string;
  destructive?: boolean;
}

export function AccountActions({ investor }: { investor: AdminInvestorDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const frozen = investor.status === 'SUSPENDED' || investor.status === 'RESTRICTED';
  const blocked = investor.withdrawalsBlockedAt !== null;

  const controls: Control[] = [
    ...(frozen
      ? [
          {
            action: (investor.status === 'SUSPENDED' ? 'reinstate' : 'unrestrict') as Action,
            label: investor.status === 'SUSPENDED' ? 'Reinstate account' : 'Lift restriction',
            icon: <Unlock className="size-3.5" />,
            consequence:
              'They will be able to sign in and move money again, exactly as before.',
          },
        ]
      : [
          {
            action: 'restrict' as Action,
            label: 'Restrict money',
            icon: <Lock className="size-3.5" />,
            consequence:
              'They can still sign in and see their balance, holdings and history — but cannot deposit, invest, withdraw or change their payout account. Every session is ended immediately.',
          },
          {
            action: 'suspend' as Action,
            label: 'Suspend account',
            icon: <ShieldOff className="size-3.5" />,
            consequence:
              'They cannot sign in at all. Their balance and investments are untouched and remain theirs. Every session is ended immediately.',
            destructive: true,
          },
        ]),
    {
      action: (blocked ? 'unblock' : 'block') as Action,
      label: blocked ? 'Unblock withdrawals' : 'Block withdrawals',
      icon: <Ban className="size-3.5" />,
      consequence: blocked
        ? 'They will be able to request withdrawals again.'
        : 'They cannot request a withdrawal, and any withdrawal already in the queue will be refused at approval. Everything else keeps working.',
    },
    {
      action: 'kyc-reset' as Action,
      label: 'Require identity re-check',
      icon: <KeyRound className="size-3.5" />,
      consequence:
        'They will have to verify their identity again before they can invest. It does not count against their attempt limit, and they are emailed the reason you type.',
    },
    ...(investor.emailVerified
      ? []
      : [
          {
            action: 'verify-email' as Action,
            label: 'Mark email verified',
            icon: <MailCheck className="size-3.5" />,
            consequence:
              'Use when the confirmation link never arrived. It does not change a suspended or restricted account.',
          },
        ]),
  ];

  const endpoint: Record<Action, { path: string; body: (r: string) => object }> = {
    restrict: { path: 'status', body: (r) => ({ action: 'restrict', reason: r }) },
    suspend: { path: 'status', body: (r) => ({ action: 'suspend', reason: r }) },
    reinstate: { path: 'status', body: (r) => ({ action: 'reinstate', reason: r }) },
    unrestrict: { path: 'status', body: (r) => ({ action: 'unrestrict', reason: r }) },
    block: { path: 'withdrawals', body: (r) => ({ action: 'block', reason: r }) },
    unblock: { path: 'withdrawals', body: (r) => ({ action: 'unblock', reason: r }) },
    'kyc-reset': { path: 'kyc-reset', body: (r) => ({ reason: r }) },
    'verify-email': { path: 'verify-email', body: (r) => ({ reason: r }) },
  };

  async function run(action: Action) {
    setBusy(true);
    setError(null);
    try {
      const { path, body } = endpoint[action];
      await apiFetch(`/admin/investors/${investor.id}/${path}`, { method: 'POST', body: body(reason) });
      setOpen(null);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const active = controls.find((c) => c.action === open);

  return (
    <div className="rounded-xl border border-hairline bg-surface p-5">
      <p className="text-[0.875rem] font-medium text-foreground">Account controls</p>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-muted-foreground">
        Everything here is recorded against your name, with the reason you give.
      </p>

      {frozen ? (
        <div className="mt-3 rounded-lg border border-pending/40 bg-pending/5 px-3 py-2">
          <p className="text-[0.75rem] font-medium text-foreground">
            {investor.status === 'SUSPENDED'
              ? 'Suspended — cannot sign in'
              : 'Restricted — can sign in, cannot move money'}
          </p>
        </div>
      ) : null}

      {blocked ? (
        <div className="mt-2 rounded-lg border border-pending/40 bg-pending/5 px-3 py-2">
          <p className="text-[0.75rem] font-medium text-foreground">Withdrawals blocked</p>
        </div>
      ) : null}

      {active ? (
        <div className="mt-4">
          <p className="text-[0.8125rem] font-medium text-foreground">{active.label}</p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-muted-foreground">
            {active.consequence}
          </p>

          <label htmlFor="action-reason" className="mt-3 block text-[0.75rem] font-medium text-foreground">
            Reason
          </label>
          <textarea
            id="action-reason"
            autoFocus
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you doing this? The investor may be shown it."
            className="mt-1 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-[0.8125rem] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
          />

          {error ? (
            <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[0.75rem] text-destructive">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}

          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant={active.destructive ? 'destructive' : 'default'}
              onClick={() => run(active.action)}
              disabled={busy || reason.trim().length < 5}
              className="h-9 text-[0.8125rem]"
            >
              {busy ? 'Working…' : `Confirm — ${active.label.toLowerCase()}`}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(null);
                setReason('');
                setError(null);
              }}
              disabled={busy}
              className="h-9 text-[0.8125rem]"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {controls.map((control) => (
            <Button
              key={control.action}
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(control.action);
                setError(null);
              }}
              className="h-9 gap-1.5 text-[0.8125rem]"
            >
              {control.icon}
              {control.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
