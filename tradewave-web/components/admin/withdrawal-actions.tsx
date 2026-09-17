'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, errorMessage } from '@/lib/api';

/**
 * Releasing, refusing, or recording a payment made by hand.
 *
 * Modelled on property-status-actions: one `busy` holding which action is
 * running, every button disabled while any of them is. Rejecting asks for a
 * reason inline rather than in a dialog, because there is no dialog primitive
 * in this codebase and the reason is short.
 *
 * "Mark paid" is not a shortcut — it is the rail that works when the provider
 * cannot be reached at all, which given the IP allowlist is the state this
 * platform is actually in today.
 */
type Action = 'approve' | 'reject' | 'mark-paid';

export function WithdrawalActions({
  withdrawalId,
  status,
  full = false,
}: {
  withdrawalId: string;
  status: string;
  /** Wider tap targets for the card layout on a phone. */
  full?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  async function run(action: Action, body?: Record<string, unknown>) {
    setBusy(action);
    setError(null);
    try {
      await apiFetch(`/admin/withdrawals/${withdrawalId}/${action}`, {
        method: 'POST',
        ...(body ? { body } : {}),
      });
      setRejecting(false);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const size = full ? 'h-10 w-full text-[0.8125rem]' : 'h-8 px-2.5 text-[0.75rem]';
  const disabled = busy !== null;

  if (status !== 'REQUESTED' && status !== 'APPROVED') return null;

  return (
    <div className={full ? 'space-y-2' : 'flex items-center justify-end gap-1.5'}>
      {status === 'REQUESTED' && !rejecting ? (
        <>
          <Button
            type="button"
            onClick={() => run('approve')}
            disabled={disabled}
            className={`gap-1.5 ${size}`}
          >
            <Send className="size-3.5" />
            {busy === 'approve' ? 'Sending…' : 'Approve & send'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setRejecting(true)}
            disabled={disabled}
            className={`gap-1.5 ${size}`}
          >
            <X className="size-3.5" />
            Reject
          </Button>
        </>
      ) : null}

      {status === 'REQUESTED' && rejecting ? (
        <div className={full ? 'space-y-2' : 'flex w-full items-center gap-1.5'}>
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why? The investor is told this."
            className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-[0.75rem] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
          />
          <Button
            type="button"
            variant="destructive"
            onClick={() => run('reject', { reason })}
            disabled={disabled || reason.trim().length < 3}
            className={full ? 'h-10 w-full text-[0.8125rem]' : 'h-8 px-2.5 text-[0.75rem]'}
          >
            {busy === 'reject' ? 'Rejecting…' : 'Confirm'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRejecting(false)}
            disabled={disabled}
            className={full ? 'h-10 w-full text-[0.8125rem]' : 'h-8 px-2.5 text-[0.75rem]'}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {status === 'APPROVED' ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => run('mark-paid')}
          disabled={disabled}
          className={`gap-1.5 ${size}`}
        >
          <Check className="size-3.5" />
          {busy === 'mark-paid' ? 'Saving…' : 'Mark paid by hand'}
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="mt-1.5 text-[0.6875rem] leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
