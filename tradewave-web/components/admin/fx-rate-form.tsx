'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setFxRateSchema, type SetFxRateValues } from '@/lib/schemas';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import { formatNgn, formatUsd } from '@/lib/money';

/**
 * Sets the rate depositors are quoted and credited at.
 *
 * Takes NAIRA, not kobo. The API's contract is kobo per dollar — ₦1,650.00 is
 * 165000 — and a person typing that figure by hand is one slipped digit away
 * from a hundredfold error in somebody's balance. So the conversion happens
 * here, and what will actually be stored is echoed back before submit.
 *
 * The spread is assumed to be already applied: this is the customer rate, not
 * the market one. `midPerDollar` is optional and records the market rate it was
 * derived from, so the margin on a given deposit stays reconstructable later.
 */
export function FxRateForm({ currentMinorPerUnit }: { currentMinorPerUnit: string | null }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SetFxRateValues>({
    resolver: zodResolver(setFxRateSchema),
    defaultValues: {
      nairaPerDollar: currentMinorPerUnit
        ? (Number(currentMinorPerUnit) / 100).toString()
        : '',
    },
  });

  const typed = watch('nairaPerDollar');
  const kobo = toKobo(typed);

  async function onSubmit(values: SetFxRateValues) {
    setFormError(null);
    setSaved(false);

    const minorPerUnit = toKobo(values.nairaPerDollar);
    if (minorPerUnit === null) {
      setError('nairaPerDollar', { message: 'Naira per dollar, e.g. 1650 or 1650.50' });
      return;
    }

    try {
      await apiFetch('/fx/rate', {
        method: 'PUT',
        body: { minorPerUnit: minorPerUnit.toString() },
      });
      setSaved(true);
      reset({ nairaPerDollar: values.nairaPerDollar });
      // Server components hold the current rate and the history table.
      router.refresh();
    } catch (err) {
      // The service bounds-checks and answers 400 with a usable message; show it
      // on the field rather than as a banner, since the field is what is wrong.
      if (err instanceof ApiError && err.status === 400) {
        setError('nairaPerDollar', { message: err.message });
        return;
      }
      setFormError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-md">
      <label
        htmlFor="nairaPerDollar"
        className="block text-[0.8125rem] font-medium text-foreground"
      >
        Naira per dollar
      </label>
      <p className="mt-1 text-[0.75rem] text-muted-foreground">
        The rate a depositor is quoted and credited at — spread already included.
      </p>

      <div className="relative mt-2">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[0.875rem] font-medium text-muted-foreground">
          ₦
        </span>
        <Input
          id="nairaPerDollar"
          inputMode="decimal"
          autoComplete="off"
          placeholder="1650"
          className="pl-8 tabular-nums"
          aria-invalid={errors.nairaPerDollar ? true : undefined}
          {...register('nairaPerDollar')}
        />
      </div>

      {errors.nairaPerDollar ? (
        <p role="alert" className="mt-1.5 text-[0.75rem] text-destructive">
          {errors.nairaPerDollar.message}
        </p>
      ) : kobo !== null ? (
        // The confirmation that makes a slipped decimal visible before it is
        // saved, rather than after a depositor notices their balance is wrong.
        <div className="mt-2.5 rounded-lg border border-hairline bg-canvas px-3 py-2.5 text-[0.75rem] leading-relaxed">
          <p className="text-foreground">
            <span className="font-medium tabular-nums">{formatNgn(kobo.toString())}</span> ={' '}
            <span className="font-medium tabular-nums">{formatUsd('100')}</span>
          </p>
          <p className="mt-0.5 text-muted-foreground">
            Stored as <span className="tabular-nums">{kobo}</span> kobo per dollar. A
            ₦165,000 transfer would credit{' '}
            <span className="tabular-nums">
              {/* Floor, matching the server: usdCentsFromKobo truncates so a
                  fractional cent is never credited into existence. */}
              {formatUsd(Math.floor((16_500_000 * 100) / kobo))}
            </span>
            .
          </p>
        </div>
      ) : null}

      {formError ? (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.75rem] text-destructive"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" disabled={isSubmitting} className="h-10">
          {isSubmitting ? 'Publishing…' : 'Publish rate'}
        </Button>
        {saved ? (
          <span className="flex items-center gap-1.5 text-[0.8125rem] text-gain">
            <Check className="size-3.5" />
            Published
          </span>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Naira string to kobo, without a float round-trip.
 *
 * `Number('1650.55') * 100` is 165054.99999999997, which truncates to 165054 —
 * a rate one kobo below what was typed, applied to every deposit until someone
 * changes it. Splitting the string keeps it exact, the same way
 * lib/money.ts:parseDollarInput does.
 *
 * A number rather than a BigInt, matching the rest of this layer: the regex caps
 * the input at seven digits and two decimals, so the result never exceeds nine
 * digits — nowhere near MAX_SAFE_INTEGER. The exact value still leaves here as a
 * string, because the API's contract is a string of kobo.
 */
function toKobo(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[,\s₦]/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const kobo = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return kobo > 0 ? kobo : null;
}
