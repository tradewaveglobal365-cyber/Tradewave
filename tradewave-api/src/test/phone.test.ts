import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../lib/phone';

/**
 * The market is Nigeria, and the same person types their number three different
 * ways on three different days. Support looking somebody up by the number they
 * read out loud needs all three to be one string.
 */
describe('normalizePhone', () => {
  it('accepts the three shapes a Nigerian number actually arrives in', () => {
    expect(normalizePhone('08030000000')).toBe('+2348030000000');
    expect(normalizePhone('2348030000000')).toBe('+2348030000000');
    expect(normalizePhone('+2348030000000')).toBe('+2348030000000');
    // No trunk prefix and no country code — common when copied out of a form.
    expect(normalizePhone('8030000000')).toBe('+2348030000000');
  });

  it('strips whatever formatting somebody typed', () => {
    expect(normalizePhone('0803 000 0000')).toBe('+2348030000000');
    expect(normalizePhone('+234 (803) 000-0000')).toBe('+2348030000000');
    expect(normalizePhone('  08030000000  ')).toBe('+2348030000000');
  });

  it('believes an explicit country code rather than assuming Nigeria', () => {
    // A Ghanaian or British investor must not be silently rewritten into a
    // Nigerian number that reaches somebody else entirely.
    expect(normalizePhone('+233201234567')).toBe('+233201234567');
    expect(normalizePhone('+447700900123')).toBe('+447700900123');
  });

  it('refuses what it cannot resolve, rather than guessing', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    // A local number with a digit missing.
    expect(normalizePhone('0803000000')).toBeNull();
    // Too long to be an E.164 number at all.
    expect(normalizePhone('+2348030000000000')).toBeNull();
    // Neither a trunk prefix, nor a known country code, nor a local length:
    // guessing here puts a working number that reaches nobody in the database.
    expect(normalizePhone('5551234')).toBeNull();
  });
});
