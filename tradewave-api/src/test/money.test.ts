import { describe, expect, it } from 'vitest';
import {
  bigintReplacer,
  formatAed,
  filsToDirhamString,
  dirhamToFils,
} from '../lib/money';
import { addMonths, computeAccrual } from '../modules/investment/accrual';

describe('dirhamToFils', () => {
  it('converts whole and fractional dirham exactly', () => {
    expect(dirhamToFils('1000')).toBe(100_000n);
    expect(dirhamToFils('1234.56')).toBe(123_456n);
    expect(dirhamToFils('0.01')).toBe(1n);
    expect(dirhamToFils('18500000')).toBe(1_850_000_000n);
  });

  it('does not lose a fils to floating point', () => {
    // Number('1234.56') * 100 === 123455.99999999999, which truncates to 123455.
    expect(dirhamToFils('1234.56')).toBe(123_456n);
    expect(dirhamToFils('0.29')).toBe(29n);
    expect(dirhamToFils('1.10')).toBe(110n);
  });

  it('truncates sub-fils precision rather than rounding up', () => {
    // We never invent money the user did not send.
    expect(dirhamToFils('1.999')).toBe(199n);
  });

  it('pads a single decimal place correctly', () => {
    expect(dirhamToFils('1.5')).toBe(150n);
  });

  it('rejects anything that is not a plain decimal', () => {
    for (const bad of ['', 'abc', '1,000', 'AED 100', '1.2.3', '1e5']) {
      expect(() => dirhamToFils(bad)).toThrow();
    }
  });

  it('round-trips through filsToDirhamString', () => {
    for (const v of ['0.00', '1.05', '1234.56', '18500000.00']) {
      expect(filsToDirhamString(dirhamToFils(v))).toBe(v);
    }
  });
});

describe('formatAed', () => {
  it('renders fils as dirham currency', () => {
    // Intl uses a non-breaking space in some environments; normalise it.
    const out = formatAed(20_000_000_000n).replace(/ /g, ' ');
    expect(out).toContain('200,000,000.00');
  });

  it('handles zero', () => {
    expect(formatAed(0n)).toContain('0.00');
  });
});

describe('bigintReplacer', () => {
  it('serialises BigInt as a string instead of throwing', () => {
    expect(() => JSON.stringify({ a: 1n })).toThrow(TypeError);
    expect(JSON.stringify({ balanceFils: 100_000n }, bigintReplacer)).toBe(
      '{"balanceFils":"100000"}',
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
    principalFils: dirhamToFils('100000'), // AED 100,000
    annualReturnBps: 850, // 8.50% p.a.
    investedAt,
    maturesAt: addMonths(investedAt, 24),
  };

  it('accrues nothing on day zero', () => {
    const r = computeAccrual(base, investedAt);
    expect(r.accruedFils).toBe(0n);
    expect(r.currentValueFils).toBe(base.principalFils);
    expect(r.isMatured).toBe(false);
  });

  it('accrues about half the annual rate at the six month mark', () => {
    const r = computeAccrual(base, new Date('2026-07-01T00:00:00Z'));
    // 181 elapsed days: 100000 * 850 * 181 / (10000 * 365) = AED 4,215.06
    expect(r.elapsedDays).toBe(181);
    expect(filsToDirhamString(r.accruedFils)).toBe('4215.06');
  });

  it('reaches the full declared return at maturity', () => {
    const r = computeAccrual(base, base.maturesAt);
    // 730 day term at 8.5% p.a. = 17% of principal.
    expect(r.isMatured).toBe(true);
    expect(filsToDirhamString(r.accruedFils)).toBe('17000.00');
    expect(filsToDirhamString(r.currentValueFils)).toBe('117000.00');
  });

  it('STOPS growing after maturity', () => {
    const atMaturity = computeAccrual(base, base.maturesAt);
    const longAfter = computeAccrual(base, new Date('2030-01-01T00:00:00Z'));
    expect(longAfter.accruedFils).toBe(atMaturity.accruedFils);
    expect(longAfter.progress).toBe(1);
  });

  it('never accrues negatively for a future-dated investment', () => {
    const r = computeAccrual(base, new Date('2025-01-01T00:00:00Z'));
    expect(r.accruedFils).toBe(0n);
    expect(r.elapsedDays).toBe(0);
  });

  it('projects the maturity total independently of the current date', () => {
    const early = computeAccrual(base, new Date('2026-02-01T00:00:00Z'));
    const late = computeAccrual(base, new Date('2027-06-01T00:00:00Z'));
    expect(early.projectedTotalFils).toBe(late.projectedTotalFils);
    expect(filsToDirhamString(early.projectedTotalFils)).toBe('117000.00');
  });

  it('does not lose precision by dividing before multiplying', () => {
    // A tiny holding whose daily accrual is far below one fils. Dividing first
    // would floor every intermediate to zero and accrue nothing at all.
    const tiny = computeAccrual(
      { ...base, principalFils: dirhamToFils('100') },
      new Date('2026-12-31T00:00:00Z'),
    );
    expect(tiny.accruedFils).toBeGreaterThan(0n);
    expect(filsToDirhamString(tiny.accruedFils)).toBe('8.47');
  });
});
