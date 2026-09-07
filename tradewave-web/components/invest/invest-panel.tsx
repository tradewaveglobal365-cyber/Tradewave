'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, CheckCircle2, Wallet as WalletIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import type { Property } from '@/lib/types';
import {
  filsToNumber,
  formatAed,
  formatAedCompact,
  formatBps,
  formatTerm,
  parseDirhamInput,
  projectedReturnFils,
} from '@/lib/money';

/**
 * The invest panel — the core interaction of the product.
 *
 * Every figure shown here is recomputed by the server on submit; this exists so
 * the numbers move as the user types. `projectedReturnFils` deliberately mirrors
 * the server rule rather than inventing its own, so the amount quoted before
 * investing is the amount that actually accrues afterwards.
 */
export function InvestPanel({
  property,
  walletBalanceFils = '0',
}: {
  property: Property;
  walletBalanceFils?: string;
}) {
  const router = useRouter();
  const [raw, setRaw] = useState('');
  const [step, setStep] = useState<'amount' | 'review' | 'done'>('amount');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const minFils = filsToNumber(property.minInvestmentFils);
  const remainingFils = filsToNumber(property.remainingFils);
  const totalFils = filsToNumber(property.totalValueFils);
  const balanceFils = filsToNumber(walletBalanceFils);

  const amountFils = parseDirhamInput(raw);

  const calc = useMemo(() => {
    if (amountFils === null || amountFils <= 0) return null;
    const profit = projectedReturnFils(amountFils, property.annualReturnBps, property.termMonths);
    return {
      profit,
      atMaturity: amountFils + profit,
      stakePercent: totalFils === 0 ? 0 : (amountFils / totalFils) * 100,
    };
  }, [amountFils, property.annualReturnBps, property.termMonths, totalFils]);

  // Ordered by which the user should fix first — an amount below the minimum is
  // a more useful message than "insufficient balance" on the same input.
  const error =
    amountFils === null
      ? raw.trim() === ''
        ? null
        : 'Enter a valid amount'
      : amountFils < minFils
        ? `Minimum investment is ${formatAed(minFils)}`
        : amountFils > remainingFils
          ? `Only ${formatAedCompact(property.remainingFils)} remains in this property`
          : null;

  const underfunded = amountFils !== null && !error && amountFils > balanceFils;
  // Reviewing is not committing. A user should be able to read the full terms
  // before deciding to deposit money, so the funding gate sits on the final
  // confirm, not on getting to it.
  const canReview = amountFils !== null && !error;

  const quickAmounts = [minFils, minFils * 5, minFils * 10, minFils * 25].filter(
    (v, i, arr) => v <= remainingFils && arr.indexOf(v) === i,
  );

  async function confirm() {
    if (amountFils === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiFetch('/investments', {
        method: 'POST',
        // Money goes over the wire as a STRING of fils — a JSON number would
        // invite a float round-trip on a value that must stay exact.
        body: { propertyId: property.id, amountFils: String(amountFils) },
      });
      setStep('done');
      // The property's funding progress and the wallet balance both changed,
      // and both are server-rendered.
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_FUNDS') {
        setSubmitError('Your wallet balance is not enough. Fund your wallet and try again.');
      } else if (err instanceof ApiError && err.code === 'KYC_REQUIRED') {
        setSubmitError(
          'Verify your identity before investing — you can do it from Settings in about a minute.',
        );
      } else if (err instanceof ApiError && err.code === 'KYC_PENDING') {
        setSubmitError(
          "We're still reviewing your identity check. You'll be able to invest as soon as it clears.",
        );
      } else {
        setSubmitError(errorMessage(err));
      }
      setSubmitting(false);
    }
  }

  if (step === 'done' && amountFils !== null && calc) {
    return (
      <div className="text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-gain/10">
          <CheckCircle2 className="size-5 text-gain" />
        </div>
        <h3 className="mt-4 text-[1rem] font-semibold text-foreground">Investment confirmed</h3>
        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted-foreground">
          You now hold a {calc.stakePercent.toFixed(3)}% stake in {property.title}. It starts
          accruing today.
        </p>
        <Button asChild className="mt-5 h-11 w-full md:h-10">
          <Link href="/portfolio">View portfolio</Link>
        </Button>
      </div>
    );
  }

  if (step === 'review' && calc && amountFils !== null) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setStep('amount')}
          className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Change amount
        </button>

        <h3 className="text-[1rem] font-semibold text-foreground">Review your investment</h3>

        <dl className="mt-4 space-y-2.5 border-y border-hairline py-4 text-[0.8125rem]">
          <Row label="Property" value={property.title} />
          <Row label="You invest" value={formatAed(amountFils)} strong />
          <Row label="Your stake" value={`${calc.stakePercent.toFixed(3)}%`} />
          <Row label="Declared return" value={`${formatBps(property.annualReturnBps)} per year`} />
          <Row label="Term" value={formatTerm(property.termMonths)} />
          <Row label="Profit at maturity" value={`+${formatAed(calc.profit)}`} tone="gain" />
          <Row label="Total at maturity" value={formatAed(calc.atMaturity)} strong />
        </dl>

        <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[0.75rem] leading-relaxed text-muted-foreground">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 rounded border-input accent-brand-700"
          />
          <span>
            I understand my capital is at risk, that the declared return is not guaranteed, and
            that funds are committed until {formatTerm(property.termMonths)} from today.
          </span>
        </label>

        {underfunded ? (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-lg border border-pending/25 bg-pending/5 px-3.5 py-3 text-[0.8125rem] leading-snug text-pending"
          >
            <AlertCircle className="mt-px size-4 shrink-0" />
            <span>
              Your wallet is short by {formatAed(amountFils - balanceFils)}.{' '}
              <Link href="/wallet" className="font-medium underline underline-offset-4">
                Fund your wallet
              </Link>{' '}
              to complete this.
            </span>
          </div>
        ) : null}

        {submitError ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-[0.8125rem] leading-snug text-destructive"
          >
            <AlertCircle className="mt-px size-4 shrink-0" />
            <span>{submitError}</span>
          </div>
        ) : null}

        <Button
          onClick={confirm}
          disabled={!accepted || underfunded || submitting}
          className="mt-4 h-11 w-full md:h-10"
        >
          {submitting ? 'Confirming…' : 'Confirm investment'}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-[1rem] font-semibold text-foreground">Invest in this property</h3>

      <label
        htmlFor="invest-amount"
        className="mt-4 block text-[0.75rem] font-medium text-muted-foreground"
      >
        Amount
      </label>
      <div className="relative mt-1.5">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[0.875rem] font-medium text-muted-foreground">
          AED
        </span>
        <input
          id="invest-amount"
          inputMode="decimal"
          autoComplete="off"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="0"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'invest-error' : 'invest-limits'}
          className="h-12 w-full rounded-lg border border-input bg-surface pr-3 pl-13 text-right text-[1.125rem] font-semibold tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20"
        />
      </div>

      {error ? (
        <p id="invest-error" role="alert" className="mt-1.5 text-[0.75rem] text-destructive">
          {error}
        </p>
      ) : (
        <p id="invest-limits" className="mt-1.5 text-[0.75rem] text-muted-foreground">
          Minimum {formatAedCompact(property.minInvestmentFils)} &middot;{' '}
          {formatAedCompact(property.remainingFils)} available
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {quickAmounts.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setRaw(String(v / 100))}
            className="rounded-full border border-hairline px-3 py-1 text-[0.75rem] font-medium text-foreground transition-colors hover:border-brand-400 hover:bg-brand-50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {formatAedCompact(v)}
          </button>
        ))}
      </div>

      {calc && !error ? (
        <dl className="mt-5 space-y-2.5 border-t border-hairline pt-4 text-[0.8125rem]">
          <Row label="Your stake" value={`${calc.stakePercent.toFixed(3)}%`} />
          <Row
            label="Return"
            value={`${formatBps(property.annualReturnBps)}/yr · ${formatTerm(property.termMonths)}`}
          />
          <Row label="Profit at maturity" value={`+${formatAed(calc.profit)}`} tone="gain" />
          <Row label="Total at maturity" value={formatAed(calc.atMaturity)} strong />
        </dl>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-3 rounded-lg bg-canvas px-3.5 py-3">
        <span className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
          <WalletIcon className="size-3.5" />
          Wallet
        </span>
        <span className="text-[0.8125rem] font-semibold tabular-nums text-foreground">
          {formatAed(balanceFils)}
        </span>
      </div>

      {underfunded ? (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2.5 rounded-lg border border-pending/25 bg-pending/5 px-3.5 py-3 text-[0.8125rem] leading-snug text-pending"
        >
          <AlertCircle className="mt-px size-4 shrink-0" />
          <span>
            You need {formatAed(amountFils - balanceFils)} more.{' '}
            <Link href="/wallet" className="font-medium underline underline-offset-4">
              Fund your wallet
            </Link>
          </span>
        </div>
      ) : null}

      <Button
        onClick={() => setStep('review')}
        disabled={!canReview}
        className="mt-4 h-11 w-full md:h-10"
      >
        Review investment
      </Button>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: 'gain';
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`tabular-nums ${
          tone === 'gain' ? 'font-semibold text-gain' : strong ? 'font-semibold text-foreground' : 'text-foreground'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
