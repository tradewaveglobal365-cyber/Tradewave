import { z } from 'zod';
import { isCommonPassword } from '../../lib/common-passwords';
import { referralCodePattern } from '../../lib/crypto';
import { normalizePhone, phonePattern } from '../../lib/phone';

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

/**
 * Required, and stored in E.164.
 *
 * Optional until now, which left us unable to reach a meaningful share of
 * investors about their own money. There is still no OTP — the number is
 * captured, not proven — so the only cost to the person signing up is one
 * field, and normalising it here means support can find them by whatever they
 * read out over the phone. See lib/phone.
 */
const phone = z
  .string({ error: 'Phone number is required' })
  .trim()
  .min(1, 'Phone number is required')
  .regex(phonePattern, 'Enter a valid phone number')
  .transform(normalizePhone)
  .refine((v): v is string => v !== null, 'Enter a valid phone number');

export const registerSchema = z.object({
  firstName: name('First name'),
  lastName: name('Last name'),
  email,
  password,
  phone,
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

/**
 * Email OR phone number, and deliberately unvalidated beyond "not empty".
 *
 * No z.email() and no phonePattern here. A malformed identifier would then be
 * refused with a *different* response from an unknown one, which hands anybody
 * a free "is this an account?" probe — the exact oracle the duration padding
 * elsewhere in this module exists to close. Everything reaches login(), which
 * fails identically whatever the reason. See auth.service.findUserByIdentifier.
 */
const identifier = z
  .string({ error: 'Enter your email address or phone number' })
  .trim()
  .min(1, 'Enter your email address or phone number')
  .max(254, 'That is too long')
  // Harmless for digits and '+', and it is what makes the email lookup match.
  .toLowerCase();

/**
 * Accepts `email` as a deprecated alias for `identifier`.
 *
 * TRANSITIONAL — the web sent `email` until 2026-09-23. The API and the web
 * deploy separately and minutes apart, so without this, every sign-in from a
 * browser still holding the old bundle fails on a missing field for the length
 * of the gap. Delete this and both `z.preprocess` wrappers once the Vercel
 * deploy carrying `identifier` is live.
 */
const acceptLegacyEmailField = (v: unknown): unknown =>
  v && typeof v === 'object' && !('identifier' in v) && 'email' in v
    ? { ...v, identifier: (v as { email: unknown }).email }
    : v;

export const loginSchema = z.preprocess(
  acceptLegacyEmailField,
  z.object({
    identifier,
    password: z.string({ error: 'Password is required' }).min(1, 'Password is required'),
  }),
);

/**
 * CONTRACT MIRROR — see tradewave-web/lib/schemas.ts.
 *
 * The current password is required even though the caller is already
 * authenticated. A session cookie proves the browser was signed in at some
 * point; it does not prove the person at the keyboard is the account owner. An
 * unattended laptop or a stolen session is exactly the case this stops, and it
 * is why every bank asks the same thing.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ error: 'Enter your current password' })
      .min(1, 'Enter your current password'),
    password,
  })
  .refine((v) => v.currentPassword !== v.password, {
    message: 'That is the password you already have — choose a different one',
    path: ['password'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.preprocess(
  acceptLegacyEmailField,
  z.object({ identifier }),
);

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

/**
 * Profile edits.
 *
 * Every field optional — the settings form sends only what changed. Names reuse
 * the register rules exactly; a name that was acceptable at signup must not
 * become unacceptable at edit.
 *
 * Whether the NAME may change at all is a service decision, not a schema one:
 * it depends on identity-verification state, which a schema cannot see. See
 * auth.service.updateProfile.
 */
export const updateProfileSchema = z
  .object({
    firstName: name('First name'),
    lastName: name('Last name'),
    // Changeable, but no longer clearable: it is required to register, so
    // letting Settings blank it would leave an account in a state the signup
    // form will not produce, and us with no way to reach them.
    phone,
  })
  .partial();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
