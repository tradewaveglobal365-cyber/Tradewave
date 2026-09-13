/**
 * Display-side money helpers.
 *
 * The API sends money as a STRING of US cents. This module parses it for
 * rendering and nothing else — the frontend never performs money arithmetic.
 * Any figure a user acts on (a balance, an accrual, a projection) is computed
 * server-side with exact integer maths and sent here already finished.
 *
 * Parsing to Number is safe at these magnitudes: MAX_SAFE_INTEGER is roughly
 * $90 trillion in cents.
 */

export type Cents = string;

/**
 * The AED/USD peg: 3.6725 dirham to the dollar, unchanged since 1997.
 * Held ×10,000 to keep all four decimals as an integer.
 * Mirrors AED_PER_USD_X10000 in tradewave-api/src/lib/money.ts.
 *
 * The ledger is in dollars; this exists only so a Dubai property can also show
 * its dirham price, which is the number the developer actually quotes.
 */
export const AED_PER_USD_X10000 = 36_725;

export function centsToNumber(cents: Cents | number): number {
  return typeof cents === 'number' ? cents : Number(cents);
}

const usdFull = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** $1,234.56 — for balances and anything the user might reconcile to the cent. */
export function formatUsd(cents: Cents | number): string {
  return usdFull.format(centsToNumber(cents) / 100);
}

/** $200,000,000 — for headline figures where cents are noise. */
export function formatUsdWhole(cents: Cents | number): string {
  return usdWhole.format(centsToNumber(cents) / 100);
}

/** $200M / $450K — for dense cards where the full number does not fit. */
export function formatUsdCompact(cents: Cents | number): string {
  const dollars = centsToNumber(cents) / 100;
  if (dollars >= 1_000_000_000)
    return `$${(dollars / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  // One decimal, matching the millions branch. Rounding to whole thousands
  // turned a $2,500 minimum into "$3K" — overstating a minimum is the kind of
  // rounding that actually misleads someone.
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return formatUsdWhole(cents);
}

const aedWhole = new Intl.NumberFormat('en-AE', {
  style: 'currency',
  currency: 'AED',
  maximumFractionDigits: 0,
});

/**
 * The same amount in dirhams, at the peg.
 *
 * Unlike a floating currency this is an exact conversion rather than an
 * estimate, which is why it can be computed here instead of being sent by the
 * server. Shown as a secondary figure on property pages — the asset is in
 * Dubai and priced in dirhams, even though the investor holds dollars.
 */
export function formatAed(cents: Cents | number): string {
  const fils = (centsToNumber(cents) * AED_PER_USD_X10000) / 10_000;
  return aedWhole.format(fils / 100);
}

const ngnFull = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
});

/** Naira, from kobo. Only ever a deposit figure — never a stored balance. */
export function formatNgn(kobo: Cents | number): string {
  return ngnFull.format(centsToNumber(kobo) / 100);
}

/** 1800 -> "18%", 1650 -> "16.5%" */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, '')}%`;
}

export function formatTerm(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} year${years === 1 ? '' : 's'}`;
  }
  return `${months} months`;
}

/**
 * Parses what a user typed into cents, without a float round-trip.
 *
 * Accepts "10,000", "10000.50", " 10000 ". Returns null for anything that is
 * not a plain positive amount, so the caller can distinguish "empty" from
 * "invalid" rather than silently treating both as zero.
 */
export function parseDollarInput(value: string): number | null {
  const cleaned = value.replace(/[,\s]/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/**
 * Total return on a principal over a full term.
 *
 * MIRRORS projectedReturnCents in tradewave-api/src/modules/property/
 * property.service.ts. This exists so the figure updates as the user types;
 * the server recomputes it on submit and its answer is authoritative. If the
 * two ever disagree, the server is right and this is the bug.
 *
 * Math.floor matches BigInt division truncating on the server.
 */
export function projectedReturnCents(
  principalCents: number,
  annualReturnBps: number,
  termMonths: number,
): number {
  return Math.floor((principalCents * annualReturnBps * termMonths) / (10_000 * 12));
}
