import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/**
 * Opaque tokens (email verification, password reset, refresh tokens).
 *
 * The raw value is handed to the user exactly once and never stored. We keep
 * only a sha256 digest, so a database leak does not hand an attacker a set of
 * working password-reset links.
 *
 * sha256 (not argon2) is correct here: these are 256 bits of real entropy, so
 * there is nothing to brute-force, and lookups need to be fast and indexable.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Keyed digest for government identifiers (NIN, BVN, passport numbers).
 *
 * Deliberately NOT hashToken(). That function's justification above — 256 bits of
 * real entropy, nothing to brute-force — does not carry over. An 11-digit NIN has
 * only 10^11 possible values, roughly 2^36.5, so a plain sha256 of one is
 * reversible by exhaustive search in seconds on a laptop. Storing that would be
 * storing the NIN.
 *
 * The pepper is a server-side secret held outside the database, so a dump of the
 * KycVerification table on its own yields nothing. HMAC rather than argon2 because
 * this value has to stay indexable — duplicate detection compares it at write time.
 */
export function hashIdentifier(value: string): string {
  return createHmac('sha256', env.KYC_ID_PEPPER).update(value).digest('hex');
}

/** Constant-time compare of two hex digests. */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Referral code alphabet: no 0/O, no 1/I/L. Codes get read aloud, typed off a
 * screenshot, and written on paper — ambiguous glyphs cost real signups.
 */
const REFERRAL_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const REFERRAL_LENGTH = 8;

export function generateReferralCode(): string {
  let out = '';
  for (let i = 0; i < REFERRAL_LENGTH; i += 1) {
    out += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
  }
  return out;
}

export const referralCodePattern = new RegExp(
  `^[${REFERRAL_ALPHABET}]{${REFERRAL_LENGTH}}$`,
);
