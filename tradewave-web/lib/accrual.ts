/**
 * The accrual maths, mirrored for the browser.
 *
 * MIRRORS computeAccrual in tradewave-api/src/modules/investment/accrual.ts.
 * The server's answer is authoritative; this exists so the portfolio can show
 * the figure moving between page loads without asking the server anything.
 *
 * ── Why BigInt and not numbers ────────────────────────────────────────────
 * The server computes principal × bps × elapsedMs before dividing, deliberately
 * — dividing first truncates cents away. That product is enormous: $100,000 at
 * 100% over two years is around 6×10^22, and Number loses integer precision
 * above 9×10^15. Doing this in floats would put the ticker a cent or two away
 * from what the server would actually pay, which is exactly the disagreement a
 * live counter must never produce. BigInt is native in every browser this app
 * supports, and it makes the two answers identical rather than close.
 */

// BigInt() calls rather than 10_000n literals: this app compiles to ES2017,
// where the literal syntax is not available but the BigInt global is. Bumping
// the whole app's target for one file is a bigger change than this warrants.
const BPS_DENOMINATOR = BigInt(10_000);
const MS_PER_DAY = 86_400_000;
const MS_PER_YEAR = BigInt(365) * BigInt(MS_PER_DAY);

export interface LiveAccrualInput {
  principalCents: string;
  annualReturnBps: number;
  investedAt: string;
  maturesAt: string;
}

export interface LiveAccrual {
  accruedCents: bigint;
  currentValueCents: bigint;
  /** 0..1 */
  progress: number;
  msRemaining: number;
  isMatured: boolean;
}

export function liveAccrual(input: LiveAccrualInput, nowMs: number): LiveAccrual {
  const principalCents = BigInt(input.principalCents);
  const investedAt = new Date(input.investedAt).getTime();
  const maturesAt = new Date(input.maturesAt).getTime();

  const termMs = Math.max(0, maturesAt - investedAt);
  const isMatured = nowMs >= maturesAt;

  // Stop the clock at maturity, exactly as the server does — otherwise an old
  // holding keeps growing on screen and we appear to owe money we do not.
  const effective = isMatured ? maturesAt : nowMs;
  const elapsedMs = Math.min(Math.max(0, effective - investedAt), termMs);

  const accruedCents =
    (principalCents * BigInt(input.annualReturnBps) * BigInt(elapsedMs)) /
    (BPS_DENOMINATOR * MS_PER_YEAR);

  return {
    accruedCents,
    currentValueCents: principalCents + accruedCents,
    progress: termMs === 0 ? 1 : Math.min(1, elapsedMs / termMs),
    msRemaining: Math.max(0, maturesAt - nowMs),
    isMatured,
  };
}

/**
 * "1y 2m 14d 03:42:19" — the countdown to maturity.
 *
 * Seconds are always shown, because the seconds place is the part that proves
 * the number is live. Years and months are dropped once they are zero rather
 * than padded, so a holding with a week left does not read "0y 0m 6d".
 *
 * Months are approximated at 30 days. This is a countdown, not a settlement
 * figure — maturesAt is the exact instant and it is displayed in full
 * alongside.
 */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return 'Matured';

  let remaining = Math.floor(msRemaining / 1000);

  const years = Math.floor(remaining / (365 * 86_400));
  remaining -= years * 365 * 86_400;
  const months = Math.floor(remaining / (30 * 86_400));
  remaining -= months * 30 * 86_400;
  const days = Math.floor(remaining / 86_400);
  remaining -= days * 86_400;

  const hours = Math.floor(remaining / 3_600);
  remaining -= hours * 3_600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining - minutes * 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (years > 0 || months > 0) parts.push(`${months}m`);
  if (years > 0 || months > 0 || days > 0) parts.push(`${days}d`);
  parts.push(clock);

  return parts.join(' ');
}

/** Cents as dollars, from a bigint, without going through a float. */
export function centsToUsd(cents: bigint): string {
  const negative = cents < BigInt(0);
  const abs = negative ? -cents : cents;
  const whole = abs / BigInt(100);
  const part = abs % BigInt(100);
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${part.toString().padStart(2, '0')}`;
}
