import { BPS_DENOMINATOR } from '../../lib/money';

const DAYS_PER_YEAR = 365n;
const MS_PER_DAY = 86_400_000;
const MS_PER_YEAR = DAYS_PER_YEAR * BigInt(MS_PER_DAY);

export interface AccrualInput {
  principalCents: bigint;
  /** Snapshotted onto the Investment at purchase, NOT read from the Property. */
  annualReturnBps: number;
  investedAt: Date;
  maturesAt: Date;
}

export interface AccrualResult {
  principalCents: bigint;
  accruedCents: bigint;
  currentValueCents: bigint;
  /** What the holding is worth at maturity — the number shown as "projected". */
  projectedTotalCents: bigint;
  elapsedDays: number;
  termDays: number;
  /** 0..1, for progress bars. */
  progress: number;
  isMatured: boolean;
}

/** Whole milliseconds between two instants, floored, never negative. */
function msBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return ms <= 0 ? 0 : ms;
}

/**
 * Accrued value, DERIVED on read — never stored.
 *
 * There is no cron job and no nightly batch precisely so there is nothing to
 * miss, retry, or double-apply. Given the same inputs this returns the same
 * answer forever, and a missed run cannot corrupt a balance that was never
 * written down.
 *
 * Simple interest, pro-rated by elapsed MILLISECONDS, and hard-capped at
 * maturity:
 *
 *   accrued = principal × bps × elapsedMs ÷ (10_000 × 365 × 86_400_000)
 *
 * Continuous rather than per-day because the portfolio shows a live counter,
 * and a figure that only moves at midnight makes that counter a decoration —
 * or worse, a lie, if it ticks between increments. Whatever a screen says an
 * investor has earned at a given instant is what this function would pay at
 * that instant, and the browser recomputes it from these same four inputs.
 *
 * Multiplication before division — BigInt division truncates, so dividing early
 * silently discards cents on every call. At these magnitudes the intermediate
 * product is large (a $100k principal at 100% over a year is ~3×10^19) which is
 * exactly why this is BigInt and not a float.
 */
export function computeAccrual(input: AccrualInput, now: Date = new Date()): AccrualResult {
  const { principalCents, annualReturnBps, investedAt, maturesAt } = input;

  const termMs = msBetween(investedAt, maturesAt);
  const isMatured = now.getTime() >= maturesAt.getTime();

  // Stop the clock at maturity. Without this an old holding keeps growing
  // forever and the platform owes money it never agreed to.
  const effectiveDate = isMatured ? maturesAt : now;
  const elapsedMs = Math.min(msBetween(investedAt, effectiveDate), termMs);

  const accruedCents =
    (principalCents * BigInt(annualReturnBps) * BigInt(elapsedMs)) /
    (BPS_DENOMINATOR * MS_PER_YEAR);

  const projectedTotalCents =
    principalCents +
    (principalCents * BigInt(annualReturnBps) * BigInt(termMs)) /
      (BPS_DENOMINATOR * MS_PER_YEAR);

  return {
    principalCents,
    accruedCents,
    currentValueCents: principalCents + accruedCents,
    projectedTotalCents,
    // Days are still reported, because "18 of 730 days" is what a human reads.
    // They are derived from the same milliseconds rather than being the unit
    // the money is computed in.
    elapsedDays: Math.floor(elapsedMs / MS_PER_DAY),
    termDays: Math.floor(termMs / MS_PER_DAY),
    progress: termMs === 0 ? 1 : Math.min(1, elapsedMs / termMs),
    isMatured,
  };
}

/** Adds whole months to a date — used to derive maturesAt from termMonths. */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const targetDay = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + months);
  // Clamp: 31 Jan + 1 month must be 28/29 Feb, not 2/3 March.
  if (result.getUTCDate() < targetDay) result.setUTCDate(0);
  return result;
}
