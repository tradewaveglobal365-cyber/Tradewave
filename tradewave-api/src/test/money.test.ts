import { describe, expect, it } from 'vitest';
import {
  aedFilsFromCents,
  bigintReplacer,
  formatAed,
  formatUsd,
  centsToDollarString,
  dollarsToCents,
  koboFromUsdCents,
  usdCentsFromKobo,
} from '../lib/money';
import { addMonths, computeAccrual } from '../modules/investment/accrual';

describe('dollarsToCents', () => {
  it('converts whole and fractional dollars exactly', () => {
    expect(dollarsToCents('1000')).toBe(100_000n);
    expect(dollarsToCents('1234.56')).toBe(123_456n);
    expect(dollarsToCents('0.01')).toBe(1n);
    expect(dollarsToCents('18500000')).toBe(1_850_000_000n);
  });

  it('does not lose a cent to floating point', () => {
    // Number('1234.56') * 100 === 123455.99999999999, which truncates to 123455.
    expect(dollarsToCents('1234.56')).toBe(123_456n);
    expect(dollarsToCents('0.29')).toBe(29n);
    expect(dollarsToCents('1.10')).toBe(110n);
  });

  it('truncates sub-cent precision rather than rounding up', () => {
    // We never invent money the user did not send.
    expect(dollarsToCents('1.999')).toBe(199n);
  });

  it('pads a single decimal place correctly', () => {
    expect(dollarsToCents('1.5')).toBe(150n);
  });

  it('rejects anything that is not a plain decimal', () => {
    for (const bad of ['', 'abc', '1,000', '$100', '1.2.3', '1e5']) {
      expect(() => dollarsToCents(bad)).toThrow();
    }
  });

  it('round-trips through centsToDollarString', () => {
    for (const v of ['0.00', '1.05', '1234.56', '18500000.00']) {
      expect(centsToDollarString(dollarsToCents(v))).toBe(v);
    }
  });
});

describe('formatUsd', () => {
  it('renders cents as dollar currency', () => {
    const out = formatUsd(20_000_000_000n).replace(/ /g, ' ');
    expect(out).toContain('200,000,000.00');
  });

  it('handles zero', () => {
    expect(formatUsd(0n)).toContain('0.00');
  });
});

describe('the AED peg', () => {
  it('converts dollars to dirham at 3.6725', () => {
    // $1.00 -> AED 3.6725, truncated to the fil.
    expect(aedFilsFromCents(100n)).toBe(367n);
    expect(aedFilsFromCents(10_000n)).toBe(36_725n);
  });

  it('inverts the migration that redenominated the ledger, to within a cent', () => {
    // The migration ran cents = fils * 10000 / 36725.
    //
    // The round trip is deliberately NOT exact. Two truncations compound: the
    // first loses up to a cent (3.6725 fils), the second up to a fil, so the
    // bound is 4 fils — just under one US cent. Always downward, never upward,
    // because every conversion here truncates rather than rounds.
    //
    // This is the cost of redenominating and it is paid once. It matters that
    // it is bounded and signed, not that it is zero: a drift that could go
    // either way would mean some balance somewhere grew during a migration.
    for (const fils of [100n, 123_456n, 1_250_000n, 18_500_000_000n]) {
      const cents = (fils * 10_000n) / 36_725n;
      const drift = fils - aedFilsFromCents(cents);
      expect(drift).toBeGreaterThanOrEqual(0n);
      expect(drift).toBeLessThanOrEqual(4n);
    }
  });

  it('renders the dirham figure for a dollar amount', () => {
    const out = formatAed(20_000_000_000n).replace(/ /g, ' ');
    expect(out).toContain('734,500,000.00');
  });
});

describe('naira conversion', () => {
  /** Kobo per dollar: 1,650.00 naira to the dollar. */
  const RATE = 165_000n;

  it('credits the dollars a naira transfer is worth', () => {
    expect(usdCentsFromKobo(165_000_000n, RATE)).toBe(100_000n);
  });

  it('quotes the naira needed to fund a dollar amount', () => {
    expect(koboFromUsdCents(100_000n, RATE)).toBe(165_000_000n);
  });

  it('truncates a partial cent rather than inventing one', () => {
    // A cent and a bit; the remainder stays in the spread, not in the balance.
    expect(usdCentsFromKobo(165_099n, RATE)).toBe(100n);
  });

  it('refuses a zero or negative rate instead of dividing by it', () => {
    expect(() => usdCentsFromKobo(1_000n, 0n)).toThrow();
    expect(() => koboFromUsdCents(1_000n, -1n)).toThrow();
  });
});

describe('bigintReplacer', () => {
  it('serialises BigInt as a string instead of throwing', () => {
    expect(() => JSON.stringify({ a: 1n })).toThrow(TypeError);
    expect(JSON.stringify({ balanceCents: 100_000n }, bigintReplacer)).toBe(
      '{"balanceCents":"100000"}',
    );
  });
});

describe('addMonths', () => {
  it('adds whole months', () => {
    expect(addMonths(new Date('2026-01-15T00:00:00Z'), 24).toISOString()).toBe(
      '2028-01-15T00:00:00.000Z',
    );
  });

  it('clamps end-of-month overflow instead of spilling into the next month', () => {
    // 31 Jan + 1 month must be 28 Feb, not 3 March.
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });
});

describe('computeAccrual', () => {
  const investedAt = new Date('2026-01-01T00:00:00Z');
  const base = {
    principalCents: dollarsToCents('100000'), // $100,000
    annualReturnBps: 850, // 8.50% p.a.
    investedAt,
    maturesAt: addMonths(investedAt, 24),
  };

  it('accrues nothing on day zero', () => {
    const r = computeAccrual(base, investedAt);
    expect(r.accruedCents).toBe(0n);
    expect(r.currentValueCents).toBe(base.principalCents);
    expect(r.isMatured).toBe(false);
  });

  it('accrues about half the annual rate at the six month mark', () => {
    const r = computeAccrual(base, new Date('2026-07-01T00:00:00Z'));
    // 181 elapsed days: 100000 * 850 * 181 / (10000 * 365) = $4,215.06
    expect(r.elapsedDays).toBe(181);
    expect(centsToDollarString(r.accruedCents)).toBe('4215.06');
  });

  it('reaches the full declared return at maturity', () => {
    const r = computeAccrual(base, base.maturesAt);
    // 730 day term at 8.5% p.a. = 17% of principal.
    expect(r.isMatured).toBe(true);
    expect(centsToDollarString(r.accruedCents)).toBe('17000.00');
    expect(centsToDollarString(r.currentValueCents)).toBe('117000.00');
  });

  it('STOPS growing after maturity', () => {
    const atMaturity = computeAccrual(base, base.maturesAt);
    const longAfter = computeAccrual(base, new Date('2030-01-01T00:00:00Z'));
    expect(longAfter.accruedCents).toBe(atMaturity.accruedCents);
    expect(longAfter.progress).toBe(1);
  });

  it('never accrues negatively for a future-dated investment', () => {
    const r = computeAccrual(base, new Date('2025-01-01T00:00:00Z'));
    expect(r.accruedCents).toBe(0n);
    expect(r.elapsedDays).toBe(0);
  });

  it('projects the maturity total independently of the current date', () => {
    const early = computeAccrual(base, new Date('2026-02-01T00:00:00Z'));
    const late = computeAccrual(base, new Date('2027-06-01T00:00:00Z'));
    expect(early.projectedTotalCents).toBe(late.projectedTotalCents);
    expect(centsToDollarString(early.projectedTotalCents)).toBe('117000.00');
  });

  it('does not lose precision by dividing before multiplying', () => {
    // A tiny holding whose daily accrual is far below one cent. Dividing first
    // would floor every intermediate to zero and accrue nothing at all.
    const tiny = computeAccrual(
      { ...base, principalCents: dollarsToCents('100') },
      new Date('2026-12-31T00:00:00Z'),
    );
    expect(tiny.accruedCents).toBeGreaterThan(0n);
    expect(centsToDollarString(tiny.accruedCents)).toBe('8.47');
  });
});
