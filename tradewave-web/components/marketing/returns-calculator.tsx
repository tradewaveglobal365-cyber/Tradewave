'use client';

import { useId, useState } from 'react';
import { RETURNS, formatAed, formatBps } from '@/content/home';
import { cn } from '@/lib/utils';

const { calculator } = RETURNS;

/**
 * Projected total return over a full term.
 *
 * ⚠️  This mirrors `projectedReturnFils()` in
 * tradewave-api/src/modules/property/property.service.ts:
 *
 *     principal × bps × months ÷ (10 000 × 12)
 *
 * Simple interest, not compounded. If that server-side rule ever changes, this
 * has to change with it — a marketing page that quotes a better number than the
 * product pays is the worst possible bug to ship here.
 *
 * Plain floating-point is acceptable in this one place: these are whole dirhams
 * typed by a visitor moving a slider, not fils being moved between ledgers.
 */
function projectedReturn(principal: number, bps: number, months: number): number {
  return (principal * bps * months) / (10_000 * 12);
}

export function ReturnsCalculator() {
  // Explicit <number>: content/home.ts is `as const`, so the defaults infer as
  // literal types and the setters would reject any other value.
  const [amount, setAmount] = useState<number>(calculator.amount.default);
  const [months, setMonths] = useState<number>(calculator.defaultTermMonths);
  const [bps, setBps] = useState<number>(calculator.defaultYieldBps);

  const amountId = useId();
  const gain = projectedReturn(amount, bps, months);
  const total = amount + gain;
  const monthly = gain / months;

  return (
    <div className="rounded-2xl border border-hairline bg-surface p-6 shadow-sm sm:p-8">
      <h3 className="text-[1.125rem] font-semibold tracking-[-0.015em] text-foreground">
        {calculator.heading}
      </h3>
      <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted-foreground">
        {calculator.description}
      </p>

      <div className="mt-8 space-y-7">
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor={amountId} className="text-[0.875rem] font-medium text-foreground">
              Amount invested
            </label>
            <output
              htmlFor={amountId}
              className="text-[1.125rem] font-semibold tabular-nums text-foreground"
            >
              {formatAed(amount)}
            </output>
          </div>
          <input
            id={amountId}
            type="range"
            min={calculator.amount.min}
            max={calculator.amount.max}
            step={calculator.amount.step}
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
            className="mt-3.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-brand-700 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
          <div className="mt-2 flex justify-between text-[0.75rem] text-muted-foreground">
            <span>{formatAed(calculator.amount.min)}</span>
            <span>{formatAed(calculator.amount.max)}</span>
          </div>
        </div>

        <Choice
          label="Term"
          options={calculator.terms.map((term) => ({
            value: term,
            label: term === 12 ? '1 year' : `${term / 12} years`,
          }))}
          value={months}
          onChange={setMonths}
        />

        <Choice
          label="Annual yield"
          options={calculator.yields.map((rate) => ({
            value: rate,
            label: formatBps(rate),
          }))}
          value={bps}
          onChange={setBps}
        />
      </div>

      {/*
        aria-live so a screen-reader user moving the slider hears the result
        change rather than having to hunt for it.
      */}
      <dl
        aria-live="polite"
        className="mt-8 grid gap-4 border-t border-hairline pt-7 sm:grid-cols-3"
      >
        <Figure label="Total return" value={formatAed(Math.round(gain))} tone="gain" />
        <Figure label="Average per month" value={formatAed(Math.round(monthly))} tone="gain" />
        <Figure label="Value at maturity" value={formatAed(Math.round(total))} />
      </dl>

      <p className="mt-6 text-[0.75rem] leading-relaxed text-muted-foreground">
        {calculator.disclaimer}
      </p>
    </div>
  );
}

function Choice<T extends number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <span className="text-[0.875rem] font-medium text-foreground">{label}</span>
      {/* A radio group in behaviour; `role="radiogroup"` gives it the same semantics. */}
      <div role="radiogroup" aria-label={label} className="mt-3 flex gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                // h-11 rather than the shadcn default: this is a touch target on
                // a marketing page, and 44px is the floor.
                'h-11 flex-1 rounded-lg border text-[0.875rem] font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                selected
                  ? 'border-brand-700 bg-brand-700 text-white'
                  : 'border-hairline bg-surface text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'gain';
}) {
  return (
    <div>
      <dt className="text-[0.75rem] text-muted-foreground">{label}</dt>
      {/* `gain`, never brand green — these are numbers going up. */}
      <dd
        className={cn(
          'mt-1 text-[1.375rem] leading-tight font-semibold tabular-nums',
          tone === 'gain' ? 'text-gain' : 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
