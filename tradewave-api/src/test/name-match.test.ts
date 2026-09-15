import { describe, expect, it } from 'vitest';
import { namesMatch, normaliseName } from '../lib/name-match';

const matches = (verified: string, account: string) =>
  namesMatch(verified, account).matches;

describe('normaliseName', () => {
  it('uppercases, splits and drops punctuation', () => {
    expect(normaliseName('Joshua Okoghie')).toEqual(['JOSHUA', 'OKOGHIE']);
    expect(normaliseName('  joshua   okoghie  ')).toEqual(['JOSHUA', 'OKOGHIE']);
    expect(normaliseName('JOSHUA, OKOGHIE.')).toEqual(['JOSHUA', 'OKOGHIE']);
  });

  it('splits a double-barrelled surname into matchable tokens', () => {
    expect(normaliseName('Ngozi Okonjo-Iweala')).toEqual(['NGOZI', 'OKONJO', 'IWEALA']);
  });

  it('drops titles, which carry no identity', () => {
    expect(normaliseName('MR JOSHUA OKOGHIE')).toEqual(['JOSHUA', 'OKOGHIE']);
    expect(normaliseName('Dr. Ngozi Okonjo')).toEqual(['NGOZI', 'OKONJO']);
  });
});

describe('a real customer is not turned away', () => {
  it('accepts the same name in the same order', () => {
    expect(matches('Joshua Okoghie', 'JOSHUA OKOGHIE')).toBe(true);
  });

  it('accepts it reordered, which is how most Nigerian banks hold it', () => {
    expect(matches('Joshua Okoghie', 'OKOGHIE JOSHUA')).toBe(true);
  });

  it('accepts an extra middle name the account carries and we do not', () => {
    expect(matches('Joshua Okoghie', 'OKOGHIE JOSHUA EMMANUEL')).toBe(true);
  });

  it('accepts an initial standing in for a first name', () => {
    expect(matches('Joshua Okoghie', 'J OKOGHIE')).toBe(true);
    expect(matches('Joshua Okoghie', 'OKOGHIE J')).toBe(true);
  });

  it('ignores case, punctuation and titles', () => {
    expect(matches('Joshua Okoghie', 'mr. joshua okoghie')).toBe(true);
  });

  it('handles a double-barrelled surname on either side', () => {
    expect(matches('Ngozi Okonjo-Iweala', 'OKONJO IWEALA NGOZI')).toBe(true);
    expect(matches('Ngozi Okonjo Iweala', 'NGOZI OKONJO-IWEALA')).toBe(true);
  });
});

describe('somebody else is refused', () => {
  it('refuses an unrelated name', () => {
    expect(matches('Joshua Okoghie', 'ADEBAYO SAMUEL')).toBe(false);
  });

  it('refuses when only one token matches', () => {
    // A shared first name is not identification.
    expect(matches('Joshua Okoghie', 'JOSHUA ADEBAYO')).toBe(false);
  });

  it('refuses a first name on its own', () => {
    // Satisfies "every shorter token appears" but not the two-token floor.
    expect(matches('Joshua Okoghie', 'JOSHUA')).toBe(false);
    expect(matches('Joshua Okoghie', 'OKOGHIE')).toBe(false);
  });

  it('refuses a repeated token pretending to be two', () => {
    // Each token of the longer name is consumed once, so this cannot pass.
    expect(matches('Joshua Okoghie', 'JOSHUA JOSHUA')).toBe(false);
  });

  it('refuses a bare initial pair', () => {
    // Initials may supplement a match but cannot carry it: "J O" fits James Obi
    // and John Olu as well as it fits Joshua Okoghie.
    expect(matches('Joshua Okoghie', 'J O')).toBe(false);
    expect(matches('Joshua Okoghie', 'J')).toBe(false);
  });

  it('refuses a surname plus a different first name', () => {
    expect(matches('Joshua Okoghie', 'SAMUEL OKOGHIE')).toBe(false);
  });
});

describe('garbage in', () => {
  it('refuses empty and punctuation-only input rather than passing it', () => {
    for (const bad of ['', '   ', '...', '12345', '!!!']) {
      expect(matches('Joshua Okoghie', bad)).toBe(false);
      expect(matches(bad, 'JOSHUA OKOGHIE')).toBe(false);
    }
  });
});
