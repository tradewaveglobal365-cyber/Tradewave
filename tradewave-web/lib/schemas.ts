import { z } from 'zod';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRACT MIRROR of tradewave-api/src/modules/auth/schemas.ts
 *
 * Client-side validation exists for fast feedback only. The API re-validates
 * everything — never treat a green field here as a security control.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const REFERRAL_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const referralCodePattern = new RegExp(`^[${REFERRAL_ALPHABET}]{8}$`);

const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

const password = z
  .string({ error: 'Password is required' })
  .min(8, 'Use at least 8 characters')
  .max(128, 'Password is too long');

const name = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(50, `${label} is too long`)
    .regex(/^[\p{L}\p{M}'\- .]+$/u, `${label} contains invalid characters`);

export const signupSchema = z.object({
  firstName: name('First name'),
  lastName: name('Last name'),
  email,
  password,
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s\-()]{7,20}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  referralCode: z.string().trim().toUpperCase().optional().or(z.literal('')),
});

export const loginSchema = z.object({
  email,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string({ error: 'Confirm your password' }).min(1, 'Confirm your password'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type SignupValues = z.input<typeof signupSchema>;
export type LoginValues = z.input<typeof loginSchema>;
export type ForgotPasswordValues = z.input<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.input<typeof resetPasswordSchema>;
