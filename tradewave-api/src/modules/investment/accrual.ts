import { BPS_DENOMINATOR } from '../../lib/money';

const DAYS_PER_YEAR = 365n;
const MS_PER_DAY = 86_400_000;

export interface AccrualInput {
  principalFils: bigint;
  /** Snapshotted onto the Investment at purchase, NOT read from the Property. */
  annualReturnBps: number;
  investedAt: Date;
  maturesAt: Date;
}

export interface AccrualResult {
  principalFils: bigint;
  accruedFils: bigint;
  currentValueFils: bigint;
  /** What the holding is worth at maturity — the number shown as "projected". */
  projectedTotalFils: bigint;
  elapsedDays: number;
  termDays: number;
  /** 0..1, for progress bars. */
  progress: number;
  isMatured: boolean;
}

/** Whole days between two instants, floored, never negative. */
function wholeDaysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / MS_PER_DAY);
}

/**
 * Accrued value, DERIVED on read — never stored.
 *
 * There is no cron job and no nightly batch precisely so there is nothing to
 * miss, retry, or double-apply. Given the same inputs this returns the same
 * answer forever, and a missed run cannot corrupt a balance that was never
 * written down.
 *
 * Simple interest, pro-rated by whole elapsed days, and hard-capped at maturity:
 *
 *   accrued = principal × bps × elapsedDays ÷ (10_000 × 365)
 *
 * Multiplication before division — BigInt division truncates, so dividing early
 * silently discards fils on every call.
 */
export function computeAccrual(input: AccrualInput, now: Date = new Date()): AccrualResult {
  const { principalFils, annualReturnBps, investedAt, maturesAt } = input;

  const termDays = wholeDaysBetween(investedAt, maturesAt);
  const isMatured = now.getTime() >= maturesAt.getTime();

  // Stop the clock at maturity. Without this an old holding keeps growing
  // forever and the platform owes money it never agreed to.
  const effectiveDate = isMatured ? maturesAt : now;
  const elapsedDays = Math.min(wholeDaysBetween(investedAt, effectiveDate), termDays);

  const accruedFils =
    (principalFils * BigInt(annualReturnBps) * BigInt(elapsedDays)) /
    (BPS_DENOMINATOR * DAYS_PER_YEAR);

  const projectedTotalFils =
    principalFils +
    (principalFils * BigInt(annualReturnBps) * BigInt(termDays)) /
      (BPS_DENOMINATOR * DAYS_PER_YEAR);

  return {
    principalFils,
    accruedFils,
    currentValueFils: principalFils + accruedFils,
    projectedTotalFils,
    elapsedDays,
    termDays,
    progress: termDays === 0 ? 1 : Math.min(1, elapsedDays / termDays),
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
