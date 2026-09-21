import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';

/**
 * The USD -> NGN rate.
 *
 * One rate matters on this platform and it is this one. The ledger is in
 * dollars, the investor pays naira, and the dirham figure shown on a property
 * page is a pegged constant rather than a rate — see lib/money.ts.
 *
 * Stored as an append-only history. Setting a rate writes a row; it never
 * updates one. That is what makes "what rate was this deposit credited at, and
 * who set it" answerable months later, and it is why a mistaken rate can be
 * superseded but not quietly erased.
 */

/**
 * Sanity bounds, in the collected currency's MINOR unit per dollar.
 *
 * Per currency, because they are three orders of magnitude apart: ₦1,650/$ is
 * 165_000 kobo, ₵11.82/$ is 1_182 pesewas. A single naira-shaped floor rejects
 * every plausible cedi rate, and a floor low enough for cedis would wave
 * through a naira rate with two digits missing.
 */
const BOUNDS = {
  NGN: { min: 10_000n, max: 100_000_000n }, // ₦100/$ .. ₦1,000,000/$
  GHS: { min: 100n, max: 1_000_000n }, //      ₵1/$ .. ₵10,000/$
} as const;

const { min: MIN_RATE, max: MAX_RATE } = BOUNDS[env.COLLECTION_CURRENCY];

export interface FxRateView {
  /** Kobo per one dollar. ₦1,650.00/$ is 165_000. */
  minorPerUnit: bigint;
  effectiveAt: Date;
}

/**
 * The rate a quote or a credit must use, or null when none is set.
 *
 * Null is a real answer, not an error to paper over: with no rate there is no
 * honest figure to show a depositor and no defensible number to credit them at.
 * Every caller fails closed on it.
 */
export async function getCurrentRate(): Promise<FxRateView | null> {
  const row = await prisma.fxRate.findFirst({
    where: { baseCurrency: 'USD', quoteCurrency: env.COLLECTION_CURRENCY, effectiveAt: { lte: new Date() } },
    orderBy: { effectiveAt: 'desc' },
    select: { minorPerUnit: true, effectiveAt: true },
  });
  return row ?? null;
}

export class InvalidRateError extends Error {}

/**
 * Records a new customer rate.
 *
 * `minorPerUnit` is the rate the depositor is quoted and credited at — spread
 * already applied. `midMinorPerUnit` is optional and records the market rate it
 * was derived from, so the spread earned on any given deposit stays
 * reconstructable after the fact.
 */
export async function setRate(params: {
  minorPerUnit: bigint;
  midMinorPerUnit?: bigint | null;
  setByUserId: string;
}): Promise<FxRateView> {
  const { minorPerUnit, midMinorPerUnit = null, setByUserId } = params;

  // Bounds rather than trust. This is a hand-typed number that decides how many
  // dollars a naira transfer becomes; a slipped decimal point is a hundredfold
  // error in someone's balance, and it would be found by the depositor first.
  if (minorPerUnit < MIN_RATE || minorPerUnit > MAX_RATE) {
    throw new InvalidRateError(
      env.COLLECTION_CURRENCY === 'GHS'
        ? 'Rate is outside the plausible range. Give it in pesewas per dollar — ₵11.82/$ is 1182.'
        : 'Rate is outside the plausible range. Give it in kobo per dollar — ₦1,650.00 is 165000.',
    );
  }

  const created = await prisma.fxRate.create({
    data: {
      baseCurrency: 'USD',
      quoteCurrency: env.COLLECTION_CURRENCY,
      minorPerUnit,
      midMinorPerUnit,
      setByUserId,
    },
    select: { minorPerUnit: true, effectiveAt: true },
  });

  logger.info(
    { minorPerUnit: minorPerUnit.toString(), quoteCurrency: env.COLLECTION_CURRENCY, setByUserId },
    'FX rate set',
  );
  return created;
}
