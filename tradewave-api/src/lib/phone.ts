/**
 * Phone numbers, normalised once on the way in.
 *
 * Every number is stored in E.164 — a leading '+', then digits, nothing else.
 * Not for elegance: the same person types 0803 000 0000, 234-803-000-0000 and
 * +2348030000000 on three different days, and support looking somebody up by
 * the number they read out loud needs all three to be the same string. Storing
 * what was typed makes that lookup a guessing game.
 *
 * There is no OTP and no carrier check. This is a contact detail we can act on,
 * not an identity claim — identity is what the KYC flow is for.
 */

/** The market. A bare local number with no country code is assumed Nigerian. */
const DEFAULT_DIALLING_CODE = '234';

/** Nigerian national numbers are 10 digits after the trunk '0'. */
const NG_NATIONAL_DIGITS = 10;

/**
 * E.164 caps the whole number at 15 digits, and nothing real is shorter than 8
 * with its country code. These bounds reject a mistyped number without
 * pretending to know every numbering plan on earth.
 */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/** What a user may type. Formatting is allowed; letters are not. */
export const phonePattern = /^\+?[0-9\s\-()]{7,20}$/;

/**
 * Normalises to E.164, or returns null when the result could not be a real
 * number.
 *
 * Null rather than a throw because every caller is a zod `.transform()` feeding
 * a `.refine()`, and a rejected number should read as a field error on the form
 * rather than a 500.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits === '') return null;

  // An explicit '+' is the user telling us the country code is already there.
  // Believed as given, so a Ghanaian or British investor is not silently
  // rewritten into a Nigerian number.
  if (hadPlus) {
    return withinBounds(digits) ? `+${digits}` : null;
  }

  // '0803…' — the trunk prefix. Dropped, then the country code goes on.
  if (digits.startsWith('0')) {
    const national = digits.slice(1);
    if (national.length !== NG_NATIONAL_DIGITS) return null;
    return `+${DEFAULT_DIALLING_CODE}${national}`;
  }

  // '234803…' — already carries the country code, just without the '+'.
  if (digits.startsWith(DEFAULT_DIALLING_CODE)) {
    return withinBounds(digits) ? `+${digits}` : null;
  }

  // '803…' — a national number with neither trunk prefix nor country code.
  if (digits.length === NG_NATIONAL_DIGITS) {
    return `+${DEFAULT_DIALLING_CODE}${digits}`;
  }

  // Anything else is ambiguous: we cannot tell a foreign number missing its '+'
  // from a local one with a digit missing, and guessing wrong puts a working
  // number in the database that reaches nobody.
  return null;
}

function withinBounds(digits: string): boolean {
  return digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS;
}
