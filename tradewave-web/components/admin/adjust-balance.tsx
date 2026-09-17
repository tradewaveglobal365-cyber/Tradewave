'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import { formatUsd, parseDollarInput } from '@/lib/money';

/**
 * Moving money into or out of a wallet by hand.
 *
 * Kept in its own card, visually separate from the other controls, because it is
 * the only operation in the product that creates or destroys money with no
 * counterparty. Everything else here changes what somebody can do; this changes
 * what they have.
 *
 * The figure is echoed back in full before it can be submitted — "add $2,500.00"
 * rather than a number in a box — because the difference between 2500 and 250000
 * is a decimal point nobody notices in a form field.
 */
export function AdjustBalance({
  investorId,
  balanceCents,
}: {
  investorId: string;
  balanceCents: string;
}) {
  const router = useRouter();
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cents = parseDollarInput(amount);
  const balance = Number(balanceCents);
  const debitTooLarge = direction === 'debit' && cents !== null && cents > balance;
  const valid = cents !== null && cents > 0 && !debitTooLarge && reason.trim().length >= 5;

  async function submit() {
    if (cents === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ balanceCents: string }>(
        `/admin/investors/${investorId}/adjust-balance`,
        {
          method: 'POST',
          // Signed cents as a string — a JSON number would invite a float
          // round-trip on a value that has to stay exact.
          body: {
            amountCents: String(direction === 'debit' ? -cents : cents),
            reason: reason.trim(),
          },
        },
      );
      setDone(formatUsd(res.balanceCents));
      setAmount('');
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-destructive/30 bg-surface p-5">
      <p className="flex items-center gap-1.5 text-[0.875rem] font-medium text-foreground">
        <Scale className="size-3.5 text-destructive" />
        Adjust balance
      </p>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-muted-foreground">
        Writes a transaction the investor can see, and emails them the reason. Current balance{' '}
        <span className="font-medium text-foreground tabular-nums">{formatUsd(balanceCents)}</span>.
      </p>

      <div className="mt-4 flex gap-1.5">
        {(['credit', 'debit'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setDirection(d);
              setDone(null);
            }}
            aria-pressed={direction === d}
            className={`h-9 rounded-lg border px-3 text-[0.8125rem] font-medium transition-colors ${
              direction === d
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-input text-muted-foreground hover:text-foreground'
            }`}
          >
            {d === 'credit' ? 'Add money' : 'Take money'}
          </button>
        ))}
      </div>

      <div className="relative mt-3">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[0.875rem] text-muted-foreground">
          $
        </span>
        <Input
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setDone(null);
          }}
          aria-invalid={debitTooLarge}
          className="pl-7 tabular-nums"
        />
      </div>

      {debitTooLarge ? (
        <p role="alert" className="mt-1 text-[0.75rem] text-destructive">
          That is more than they hold. A balance cannot go negative.
        </p>
      ) : null}

      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why? The investor is shown this, in their transactions and by email."
        className="mt-3 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-[0.8125rem] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
      />

      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-[0.75rem] text-destructive">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {done ? (
        <p className="mt-2 flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
          <Check className="size-3.5 text-gain" />
          Done — their balance is now {done}
        </p>
      ) : null}

      <Button
        type="button"
        variant="destructive"
        onClick={submit}
        disabled={busy || !valid}
        className="mt-3 h-9 text-[0.8125rem]"
      >
        {busy
          ? 'Working…'
          : cents !== null && cents > 0
            ? `${direction === 'credit' ? 'Add' : 'Take'} ${formatUsd(String(cents))}`
            : 'Enter an amount'}
      </Button>
    </div>
  );
}
