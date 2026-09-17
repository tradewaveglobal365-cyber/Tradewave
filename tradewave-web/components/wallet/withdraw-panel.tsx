'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  Check,
  Clock,
  Landmark,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import { centsToNumber, formatNgn, formatUsd, parseDollarInput } from '@/lib/money';
import type { Withdrawal, WithdrawalContext } from '@/lib/wallet';
import type { PublicUser } from '@/lib/types';

/**
 * Asking for money to be sent out.
 *
 * A ladder of early returns before the form, in the order the user hits them:
 * identity, then a destination, then the security hold, then whether one is
 * already running. Showing a form the API is certain to refuse would be worse
 * than explaining why it is not here yet — the same shape as the payout
 * account form, for the same reason.
 *
 * The naira figure is an ESTIMATE everywhere in this component, and says so.
 * The rate is pinned when the transfer is actually sent, so a firm number here
 * would be a promise the system does not make.
 */
export function WithdrawPanel({
  user,
  context,
}: {
  user: PublicUser;
  /** Null when the read failed outright — not the same as having nothing. */
  context: WithdrawalContext | null;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'amount' | 'review' | 'done'>('amount');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!context) {
    return (
      <Notice
        icon={<AlertCircle className="mt-0.5 size-4 shrink-0 text-pending" />}
        title="We could not load your wallet"
        body="Something went wrong on our side. Try again in a moment."
      >
        <Button
          type="button"
          variant="outline"
          className="mt-3 h-10"
          onClick={() => router.refresh()}
        >
          Try again
        </Button>
      </Notice>
    );
  }

  const verified = user.kycStatus === 'VERIFIED';

  // ── The ladder ─────────────────────────────────────────────────────────────

  if (!verified) {
    return (
      <Notice
        icon={<ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        title="Verify your identity first"
        body="Money can only be sent to an account in your own name, so we need to know who you are before anything can leave your wallet."
      >
        <Button asChild className="mt-3 h-11 md:h-10">
          <Link href="/verify-identity">Verify identity</Link>
        </Button>
      </Notice>
    );
  }

  if (!context.payoutAccount) {
    return (
      <Notice
        icon={<Landmark className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        title="Add a payout account"
        body="Tell us which Nigerian bank account to send your money to. It has to be in your own name."
      >
        <Button asChild className="mt-3 h-11 md:h-10">
          <Link href="/settings/payout-account">Add payout account</Link>
        </Button>
      </Notice>
    );
  }

  if (context.live) {
    return <LiveWithdrawal withdrawal={context.live} />;
  }

  // The payout schedule. Deliberately gates ASKING, not just paying: money that
  // leaves a balance on Tuesday and reaches a bank on Friday reads as somebody
  // holding your money, however carefully it is explained. Requesting and being
  // paid on the same day is the honest version of a weekly payout — so this
  // says when, rather than just no.
  if (!context.window.open) {
    return <Closed window={context.window} />;
  }

  if (context.holdUntil) {
    const until = new Date(context.holdUntil);
    return (
      <Notice
        icon={<Clock className="mt-0.5 size-4 shrink-0 text-pending" />}
        title="Withdrawals are on hold until your account settles"
        body={`You changed your payout account recently, so withdrawals are held for 24 hours. You can withdraw from ${until.toLocaleString('en-GB', {
          weekday: 'long',
          hour: '2-digit',
          minute: '2-digit',
        })}. This is what protects you if somebody else ever changes it.`}
      >
        <Button asChild variant="outline" className="mt-3 h-10">
          <Link href="/settings/payout-account">Review the account</Link>
        </Button>
      </Notice>
    );
  }

  // ── The form ───────────────────────────────────────────────────────────────

  const balance = centsToNumber(context.balanceCents);
  const minimum = centsToNumber(context.minimumCents);
  const fee = centsToNumber(context.feeCents);
  const rate = context.rateMinorPerUnit ? Number(context.rateMinorPerUnit) : null;

  const parsed = parseDollarInput(amount);
  const netCents = parsed === null ? null : parsed - fee;
  // Kobo, mirroring the API's koboFromUsdCents. Display only — the figure that
  // is actually sent is computed server-side at the rate in force then.
  const estimatedKobo =
    netCents !== null && netCents > 0 && rate !== null
      ? Math.floor((netCents * rate) / 100)
      : null;

  // Ordered so the first true thing is the most useful thing to say.
  const amountError =
    amount.trim() === ''
      ? null
      : parsed === null
        ? 'Enter an amount like 250 or 250.00'
        : parsed < minimum
          ? `The minimum withdrawal is ${formatUsd(String(minimum))}`
          : parsed > balance
            ? `That is more than your balance of ${formatUsd(context.balanceCents)}`
            : null;

  const canContinue = parsed !== null && amountError === null;

  async function submit() {
    if (parsed === null) return;
    setBusy(true);
    setFormError(null);
    try {
      await apiFetch('/wallet/withdrawals', {
        method: 'POST',
        // Money goes over the wire as a STRING of cents — a JSON number would
        // invite a float round-trip on a value that must stay exact.
        body: { amountCents: String(parsed) },
      });
      setStep('done');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.code) {
          case 'INSUFFICIENT_FUNDS':
          case 'BELOW_MINIMUM_WITHDRAWAL':
          case 'PAYOUT_ACCOUNT_TOO_NEW':
          case 'WITHDRAWAL_PENDING':
            // The API's own wording is better than anything invented here — it
            // names the figure, or the hour the hold lifts.
            setFormError(err.message);
            setStep('amount');
            return;
          default:
            break;
        }
      }
      setFormError(errorMessage(err));
      setStep('amount');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done') {
    return (
      <div>
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 size-4 shrink-0 text-gain" />
          <div>
            <p className="text-[0.875rem] font-medium text-foreground">Withdrawal requested</p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
              It has been taken out of your balance and is waiting to be reviewed and sent. We
              will email you when the money is on its way.
            </p>
          </div>
        </div>
        <Button asChild className="mt-5 h-11 w-full md:h-10">
          <Link href="/wallet">Back to wallet</Link>
        </Button>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <div>
        <button
          type="button"
          onClick={() => setStep('amount')}
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Change amount
        </button>

        <p className="mt-4 text-[0.8125rem] font-medium text-foreground">Check this over</p>

        <dl className="mt-3 overflow-hidden rounded-lg border border-hairline">
          <Row label="Amount" value={formatUsd(String(parsed))} />
          <Row label="Fee" value={formatUsd(context.feeCents)} />
          <Row label="You receive" value={formatUsd(String(netCents))} strong />
          {estimatedKobo !== null ? (
            <Row label="Roughly" value={`about ${formatNgn(String(estimatedKobo))}`} />
          ) : null}
          <Row
            label="To"
            value={`${context.payoutAccount.bankName} ${context.payoutAccount.accountNumberMasked}`}
          />
        </dl>

        <p className="mt-3 text-[0.75rem] leading-relaxed text-muted-foreground">
          The naira amount is set at the rate in force when the transfer is sent, so the figure
          above is an estimate. The exact amount is in your confirmation email.
        </p>

        {formError ? <FormError message={formError} /> : null}

        <Button type="button" onClick={submit} disabled={busy} className="mt-5 h-11 w-full md:h-10">
          {busy ? 'Requesting…' : `Withdraw ${formatUsd(String(parsed))}`}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor="withdraw-amount"
          className="text-[0.8125rem] font-medium text-foreground"
        >
          Amount
        </label>
        <button
          type="button"
          onClick={() => setAmount((balance / 100).toFixed(2))}
          className="text-[0.75rem] font-medium text-brand-700 transition-colors hover:text-brand-900"
        >
          Withdraw all
        </button>
      </div>

      <div className="relative mt-1.5">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[0.875rem] text-muted-foreground">
          $
        </span>
        <Input
          id="withdraw-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setFormError(null);
          }}
          aria-invalid={amountError !== null}
          className="pl-7 tabular-nums"
        />
      </div>

      {amountError ? (
        <p role="alert" className="mt-1 text-[0.75rem] leading-relaxed text-destructive">
          {amountError}
        </p>
      ) : (
        <p className="mt-1 flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
          <Wallet className="size-3" />
          {formatUsd(context.balanceCents)} available · {formatUsd(context.minimumCents)} minimum
        </p>
      )}

      {canContinue ? (
        <dl className="mt-4 overflow-hidden rounded-lg border border-hairline">
          <Row label={`Fee`} value={formatUsd(context.feeCents)} />
          <Row label="You receive" value={formatUsd(String(netCents))} strong />
          {estimatedKobo !== null ? (
            <Row label="Roughly" value={`about ${formatNgn(String(estimatedKobo))}`} />
          ) : null}
        </dl>
      ) : null}

      <div className="mt-4 flex items-start gap-3 rounded-lg border border-hairline bg-canvas px-4 py-3.5">
        <Landmark className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.875rem] font-medium text-foreground">
            {context.payoutAccount.bankName}
          </p>
          <p className="mt-0.5 font-mono text-[0.8125rem] tracking-[0.04em] text-muted-foreground tabular-nums">
            {context.payoutAccount.accountNumberMasked}
          </p>
          <p className="mt-1 truncate text-[0.75rem] text-muted-foreground">
            {context.payoutAccount.accountName}
          </p>
        </div>
        <Link
          href="/settings/payout-account"
          className="shrink-0 text-[0.75rem] font-medium text-brand-700 transition-colors hover:text-brand-900"
        >
          Change
        </Link>
      </div>

      {formError ? <FormError message={formError} /> : null}

      <Button
        type="button"
        onClick={() => setStep('review')}
        disabled={!canContinue}
        className="mt-5 h-11 w-full md:h-10"
      >
        Continue
      </Button>
    </div>
  );
}

/**
 * Withdrawals are shut until the next payout day.
 *
 * Leads with WHEN rather than with no. A closed door that does not say when it
 * opens is the thing people write in about, and the answer is already known.
 */
function Closed({ window }: { window: NonNullable<WithdrawalContext['window']> }) {
  const opensAt = window.opensAt ? new Date(window.opensAt) : null;

  return (
    <Notice
      icon={<CalendarClock className="mt-0.5 size-4 shrink-0 text-pending" />}
      title={opensAt ? `Withdrawals open ${whenPhrase(opensAt)}` : 'Withdrawals are closed'}
      body={`Payouts run ${window.schedule} (${window.timezone.replace('_', ' ')}). Requests are taken on the day and sent the same day, so nothing sits waiting in between.`}
    >
      {opensAt ? (
        <p className="mt-3 text-[0.75rem] font-medium text-foreground tabular-nums">
          {opensAt.toLocaleString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      ) : null}
    </Notice>
  );
}

/** "tomorrow", "in 3 days", "on Friday" — whichever reads most naturally. */
function whenPhrase(opensAt: Date): string {
  const hours = (opensAt.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hours < 1) return 'within the hour';
  if (hours < 24) return `in ${Math.round(hours)} hours`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'tomorrow';
  return `on ${opensAt.toLocaleDateString('en-GB', { weekday: 'long' })}`;
}

/** The one in flight, with the only thing the investor can still do about it. */
function LiveWithdrawal({ withdrawal }: { withdrawal: Withdrawal }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancellable = withdrawal.status === 'REQUESTED';

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/wallet/withdrawals/${withdrawal.id}/cancel`, { method: 'POST' });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 size-4 shrink-0 text-pending" />
        <div>
          <p className="text-[0.875rem] font-medium text-foreground">
            {cancellable ? 'Waiting to be reviewed' : 'On its way to your bank'}
          </p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
            {cancellable
              ? 'Somebody checks every withdrawal before the money is sent. You will get an email as soon as it goes out.'
              : 'The transfer has been sent to your bank. It usually arrives within minutes, though your bank can take longer.'}
          </p>
        </div>
      </div>

      <dl className="mt-4 overflow-hidden rounded-lg border border-hairline">
        <Row label="Amount" value={formatUsd(withdrawal.amountCents)} strong />
        <Row label="Fee" value={formatUsd(withdrawal.feeCents)} />
        {withdrawal.destinationAmountMinor ? (
          <Row label="Sending" value={formatNgn(withdrawal.destinationAmountMinor)} />
        ) : null}
        <Row
          label="To"
          value={`${withdrawal.bankName} ${withdrawal.accountNumberMasked}`}
        />
      </dl>

      {error ? <FormError message={error} /> : null}

      {cancellable ? (
        <Button
          type="button"
          variant="outline"
          onClick={cancel}
          disabled={busy}
          className="mt-5 h-11 w-full md:h-10"
        >
          {busy ? 'Cancelling…' : 'Cancel this withdrawal'}
        </Button>
      ) : null}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-2.5 last:border-b-0">
      <dt className="text-[0.75rem] text-muted-foreground">{label}</dt>
      <dd
        className={`text-right text-[0.8125rem] tabular-nums ${
          strong ? 'font-semibold text-foreground' : 'text-foreground'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.75rem] text-destructive"
    >
      <AlertCircle className="mt-px size-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function Notice({
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
    <div className="rounded-lg border border-dashed border-hairline bg-canvas px-4 py-4">
      <div className="flex items-start gap-3">
        {icon}
        <div>
          <p className="text-[0.8125rem] font-medium text-foreground">{title}</p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-muted-foreground">{body}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
