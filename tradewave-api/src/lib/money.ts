import { env } from '../config/env';
/**
 * Money handling for Tradewave.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * Every amount in this system is an integer number of US CENTS, held as a
 * BigInt. Never a float. Never a JS `number` anywhere near the database.
 *
 * Floating point cannot represent 0.1 exactly, so repeated addition of dollar
 * amounts drifts. On a balance that drift is unrecoverable — you find it months
 * later, off by a few cents, and no amount of reconciliation explains it.
 * Integer minor units make the whole class of bug impossible by construction.
 *
 * Rates are basis points, also integers: 850 bps = 8.50% per annum.
 *
 * ── Why dollars ───────────────────────────────────────────────────────────
 * The properties are in Dubai and priced by the developer in dirhams, but the
 * investors are Nigerian and think in dollars, so the ledger is denominated in
 * USD and AED is a display conversion. That conversion is exact rather than an
 * estimate, because the dirham is pegged — see AED_PER_USD_X10000.
 *
 * Naira is different in kind: it floats, so it is never stored as a balance.
 * It appears only on a Deposit row, as the amount actually received and the
 * rate that was applied at that moment.
 */

/** 1 dollar = 100 cents. */
export const CENTS_PER_DOLLAR = 100n;

/** Basis points denominator: 10_000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000n;

/**
 * The AED/USD peg.
 *
 * The dirham has been pegged at 3.6725 to the dollar since 1997, so showing a
 * property's dirham price alongside its dollar price is arithmetic, not an
 * estimate. Held ×10_000 to keep all four decimal places as an integer.
 */
export const AED_PER_USD_X10000 = 36_725n;

/** Scale factor for the constant above. */
const AED_PEG_SCALE = 10_000n;

/**
 * Parses a dollar amount into cents WITHOUT going through a float.
 *
 * `Number("1234.56") * 100` is 123455.99999999999, which truncates to the wrong
 * cent value. Splitting the string keeps it exact.
 */
export function dollarsToCents(dollars: string | number): bigint {
  const raw = typeof dollars === 'number' ? dollars.toString() : dollars.trim();

  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid dollar amount: ${JSON.stringify(dollars)}`);
  }

  const negative = raw.startsWith('-');
  const [whole = '0', fraction = ''] = raw.replace('-', '').split('.');

  // Pad to exactly 2 decimal places; anything finer than a cent is truncated,
  // never rounded up — we do not invent money.
  const cents =
    BigInt(whole) * CENTS_PER_DOLLAR + BigInt(fraction.padEnd(2, '0').slice(0, 2));

  return negative ? -cents : cents;
}

/** Cents to a plain decimal string, e.g. 123456n -> "1234.56". Not localised. */
export function centsToDollarString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / CENTS_PER_DOLLAR;
  const fraction = abs % CENTS_PER_DOLLAR;
  return `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(2, '0')}`;
}

/** USD cents -> AED fils, at the peg. Truncates, like every other conversion here. */
export function aedFilsFromCents(cents: bigint): bigint {
  return (cents * AED_PER_USD_X10000) / AED_PEG_SCALE;
}

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats cents for display. Goes through Number, which is safe here because
 * Number.MAX_SAFE_INTEGER is ~$90 trillion in cents — far beyond any realistic
 * amount — and this is the one place a float is acceptable, because the result
 * is a string for humans and never feeds back into arithmetic.
 */
export function formatUsd(cents: bigint): string {
  return usdFormatter.format(Number(cents) / 100);
}

const aedFormatter = new Intl.NumberFormat('en-AE', {
  style: 'currency',
  currency: 'AED',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** The same amount in dirhams, for the Dubai-facing figure. Exact, via the peg. */
export function formatAed(cents: bigint): string {
  return aedFormatter.format(Number(aedFilsFromCents(cents)) / 100);
}

const localFormatter = new Intl.NumberFormat(
  env.COLLECTION_CURRENCY === 'GHS' ? 'en-GH' : 'en-NG',
  {
    style: 'currency',
    currency: env.COLLECTION_CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  },
);

/**
 * The local currency being collected, from its minor unit.
 *
 * Only ever a deposit or payout figure — never a stored balance, which is
 * always USD cents. Naira and cedis both divide into 100, so the arithmetic is
 * identical and only the symbol changes.
 */
export function formatLocal(minor: bigint): string {
  return localFormatter.format(Number(minor) / 100);
}

/**
 * Converts received local currency into the dollars we credit.
 *
 * `minorPerUsd` is the minor unit per one dollar: ₦1,650.00/$ is 165_000n, and
 * ₵10.50/$ is 1_050n. No extra scale factor — the minor unit is already finer
 * than any rate anyone would publish.
 *
 * Named for the minor unit rather than the kobo because the same arithmetic
 * serves cedis: both divide into 100, and the rate carries the currency.
 *
 * Truncates, so a fractional cent is never credited into existence. The
 * remainder is worth less than a cent and stays in the spread.
 */
export function usdCentsFromMinor(minor: bigint, minorPerUsd: bigint): bigint {
  if (minorPerUsd <= 0n) throw new Error('usdCentsFromMinor: rate must be positive');
  return (minor * CENTS_PER_DOLLAR) / minorPerUsd;
}

/** The inverse, for quoting "send X to fund $Y" before the transfer happens. */
export function minorFromUsdCents(cents: bigint, minorPerUsd: bigint): bigint {
  if (minorPerUsd <= 0n) throw new Error('minorFromUsdCents: rate must be positive');
  return (cents * minorPerUsd) / CENTS_PER_DOLLAR;
}

/**
 * Applies a basis-point rate to an amount, pro-rated over a fraction of a year.
 *
 * Multiplication happens BEFORE division. BigInt division truncates, so
 * dividing early throws away precision on every single call — over a portfolio
 * that is real money lost.
 */
export function applyBps(
  amountCents: bigint,
  bps: number,
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (denominator === 0n) throw new Error('applyBps: denominator must not be zero');
  return (amountCents * BigInt(bps) * numerator) / (BPS_DENOMINATOR * denominator);
}

/**
 * JSON replacer for `app.set('json replacer', …)`.
 *
 * `JSON.stringify` throws a TypeError on BigInt rather than serialising it, so
 * without this every money-bearing response 500s. Money leaves the API as a
 * STRING of cents — a JSON number would invite the frontend to do arithmetic on
 * it, which is exactly what this module exists to prevent.
 */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
