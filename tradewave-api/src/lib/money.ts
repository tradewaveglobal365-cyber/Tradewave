/**
 * Money handling for Tradewave.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * Every amount in this system is an integer number of FILS, held as a BigInt.
 * Never a float. Never a JS `number` anywhere near the database.
 *
 * Floating point cannot represent 0.1 exactly, so repeated addition of dirham
 * amounts drifts. On a balance that drift is unrecoverable — you find it months
 * later, off by a few fils, and no amount of reconciliation explains it.
 * Integer minor units make the whole class of bug impossible by construction.
 *
 * Rates are basis points, also integers: 850 bps = 8.50% per annum.
 */

/** 1 dirham = 100 fils. */
export const FILS_PER_DIRHAM = 100n;

/** Basis points denominator: 10_000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000n;

/**
 * The AED/USD peg.
 *
 * The dirham has been pegged at 3.6725 AED to the dollar since 1997, so a USD
 * figure is an exact conversion rather than a floating estimate. Stored in fils
 * per dollar: 3.6725 AED = 367.25 fils, held ×100 to keep the quarter-fil.
 */
export const PEGGED_FILS_PER_USD = 36_725n; // ×100 scale — see usdFromFils

/**
 * Parses a dirham amount into fils WITHOUT going through a float.
 *
 * `Number("1234.56") * 100` is 123455.99999999999, which truncates to the wrong
 * fils value. Splitting the string keeps it exact.
 */
export function dirhamToFils(dirham: string | number): bigint {
  const raw = typeof dirham === 'number' ? dirham.toString() : dirham.trim();

  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid dirham amount: ${JSON.stringify(dirham)}`);
  }

  const negative = raw.startsWith('-');
  const [whole = '0', fraction = ''] = raw.replace('-', '').split('.');

  // Pad to exactly 2 decimal places; anything finer than a fil is truncated,
  // never rounded up — we do not invent money.
  const fils = BigInt(whole) * FILS_PER_DIRHAM + BigInt(fraction.padEnd(2, '0').slice(0, 2));

  return negative ? -fils : fils;
}

/** Fils to a plain decimal string, e.g. 123456n -> "1234.56". Not localised. */
export function filsToDirhamString(fils: bigint): string {
  const negative = fils < 0n;
  const abs = negative ? -fils : fils;
  const whole = abs / FILS_PER_DIRHAM;
  const fraction = abs % FILS_PER_DIRHAM;
  return `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(2, '0')}`;
}

const aedFormatter = new Intl.NumberFormat('en-AE', {
  style: 'currency',
  currency: 'AED',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats fils for display. Goes through Number, which is safe here because
 * Number.MAX_SAFE_INTEGER is ~AED 90 trillion in fils — far beyond any
 * realistic amount — and this is the one place a float is acceptable, because
 * the result is a string for humans and never feeds back into arithmetic.
 */
export function formatAed(fils: bigint): string {
  return aedFormatter.format(Number(fils) / 100);
}

/**
 * Applies a basis-point rate to an amount, pro-rated over a fraction of a year.
 *
 * Multiplication happens BEFORE division. BigInt division truncates, so
 * dividing early throws away precision on every single call — over a portfolio
 * that is real money lost.
 */
export function applyBps(
  amountFils: bigint,
  bps: number,
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (denominator === 0n) throw new Error('applyBps: denominator must not be zero');
  return (amountFils * BigInt(bps) * numerator) / (BPS_DENOMINATOR * denominator);
}

/**
 * JSON replacer for `app.set('json replacer', …)`.
 *
 * `JSON.stringify` throws a TypeError on BigInt rather than serialising it, so
 * without this every money-bearing response 500s. Money leaves the API as a
 * STRING of fils — a JSON number would invite the frontend to do arithmetic on
 * it, which is exactly what this module exists to prevent.
 */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
