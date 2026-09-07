/**
 * Display-side money helpers.
 *
 * The API sends money as a STRING of fils. This module parses it for rendering
 * and nothing else — the frontend never performs money arithmetic. Any figure a
 * user acts on (a balance, an accrual, a projection) is computed server-side
 * with exact integer maths and sent here already finished.
 *
 * Parsing to Number is safe at these magnitudes: MAX_SAFE_INTEGER is roughly
 * AED 90 trillion in fils.
 */

export type Fils = string;

/**
 * The AED/USD peg: 3.6725 dirham to the dollar, unchanged since 1997.
 * Held in fils per dollar at x100 scale to keep the quarter-fil exact.
 * Mirrors PEGGED_FILS_PER_USD in tradewave-api/src/lib/money.ts.
 */
export const PEGGED_FILS_PER_USD = 36_725;

export function filsToNumber(fils: Fils | number): number {
  return typeof fils === 'number' ? fils : Number(fils);
}

const dirhamFull = new Intl.NumberFormat('en-AE', {
  style: 'currency',
  currency: 'AED',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dirhamWhole = new Intl.NumberFormat('en-AE', {
  style: 'currency',
  currency: 'AED',
  maximumFractionDigits: 0,
});

/** AED 1,234.56 — for balances and anything the user might reconcile to the fils. */
export function formatAed(fils: Fils | number): string {
  return dirhamFull.format(filsToNumber(fils) / 100);
}

/** AED 200,000,000 — for headline figures where fils is noise. */
export function formatAedWhole(fils: Fils | number): string {
  return dirhamWhole.format(filsToNumber(fils) / 100);
}

/** AED 200M / AED 450M — for dense cards where the full number does not fit. */
export function formatAedCompact(fils: Fils | number): string {
  const dirham = filsToNumber(fils) / 100;
  if (dirham >= 1_000_000_000) return `AED ${(dirham / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (dirham >= 1_000_000) return `AED ${(dirham / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  // One decimal, matching the millions branch. Rounding to whole thousands
  // turned a AED 2,500 minimum into "AED 3K" — overstating a minimum is the
  // kind of rounding that actually misleads someone.
  if (dirham >= 1_000) return `AED ${(dirham / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return formatAedWhole(fils);
}

/**
 * USD conversion at the dirham peg.
 *
 * Unlike a floating currency, AED has been pegged at 3.6725 to the dollar since
 * 1997, so this is an exact conversion rather than an estimate. `filsPerUsd`
 * still comes from the FxRate table rather than being hardcoded, so the display
 * survives the peg ever moving.
 */
export function formatUsd(fils: Fils | number, filsPerUsd: Fils | number): string {
  const rate = filsToNumber(filsPerUsd);
  if (!rate) return '—';
  // filsPerUsd is stored at x100 scale to preserve the quarter-fil in 3.6725.
  const usd = (filsToNumber(fils) * 100) / rate;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(usd);
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
 * Parses what a user typed into fils, without a float round-trip.
 *
 * Accepts "10,000", "10000.50", " 10000 ". Returns null for anything that is
 * not a plain positive amount, so the caller can distinguish "empty" from
 * "invalid" rather than silently treating both as zero.
 */
export function parseDirhamInput(value: string): number | null {
  const cleaned = value.replace(/[,\s]/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/**
 * Total return on a principal over a full term.
 *
 * MIRRORS projectedReturnFils in tradewave-api/src/modules/property/
 * property.service.ts. This exists so the figure updates as the user types;
 * the server recomputes it on submit and its answer is authoritative. If the
 * two ever disagree, the server is right and this is the bug.
 *
 * Math.floor matches BigInt division truncating on the server.
 */
export function projectedReturnFils(
  principalFils: number,
  annualReturnBps: number,
  termMonths: number,
): number {
  return Math.floor((principalFils * annualReturnBps * termMonths) / (10_000 * 12));
}
