import { z } from 'zod';
import { isCommonPassword } from '../../lib/common-passwords';
import { referralCodePattern } from '../../lib/crypto';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRACT MIRROR
 * These shapes are duplicated in tradewave-web/lib/schemas.ts. There is no
 * shared package, so if you change a field here, change it there too.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

/**
 * Length plus a known-breached check, deliberately without symbol/digit rules.
 * Composition requirements push people toward "Password1!", which is on every
 * cracking list; length and a denylist buy far more real resistance.
 */
const password = z
  .string({ error: 'Password is required' })
  .min(8, 'Use at least 8 characters')
  .max(128, 'Password is too long')
  .refine((v) => !isCommonPassword(v), 'That password is too common — pick something less guessable');

const name = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(50, `${label} is too long`)
    .regex(/^[\p{L}\p{M}'\- .]+$/u, `${label} contains invalid characters`);

export const registerSchema = z.object({
  firstName: name('First name'),
  lastName: name('Last name'),
  email,
  password,
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s\-()]{7,20}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  country: z.string().trim().length(2, 'Use a 2-letter country code').toUpperCase().default('NG'),
  // An invalid code must never block a signup — it is normalised here and
  // silently ignored downstream if it does not resolve.
  referralCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(referralCodePattern, 'Invalid referral code')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export const loginSchema = z.object({
  email,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string({ error: 'Reset token is required' }).min(1, 'Reset token is required'),
  password,
});

export const resendVerificationSchema = z.object({ email });

export const verifyEmailQuerySchema = z.object({
  token: z
    .string({ error: 'Verification token is required' })
    .min(1, 'Verification token is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type VerifyEmailQuery = z.infer<typeof verifyEmailQuerySchema>;
