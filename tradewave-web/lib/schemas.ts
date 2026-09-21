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
  // Required now. Shape only — the server normalises to E.164 and is the one
  // that decides whether a number could be real, so duplicating that judgement
  // here would only produce two answers to the same question.
  phone: z
    .string({ error: 'Phone number is required' })
    .trim()
    .min(1, 'Phone number is required')
    .regex(/^\+?[0-9\s\-()]{7,20}$/, 'Enter a valid phone number'),
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRACT MIRROR of tradewave-api/src/modules/kyc/schemas.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const submitKycSchema = z.object({
  // No document fields: the provider collects and reads the document itself.
  consent: z
    .boolean()
    .refine((v) => v, 'You need to agree before we can verify your identity'),
});

export type SubmitKycValues = z.input<typeof submitKycSchema>;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRACT MIRROR of tradewave-api/src/modules/fx/fx.routes.ts
 *
 * Note the deliberate mismatch: the API takes KOBO per dollar as an integer
 * (₦1,650.00 is 165000), but this form takes NAIRA, because asking a person to
 * type the kobo figure is asking for a hundredfold error in somebody's balance.
 * The conversion happens in fx-rate-form.tsx, right before submit.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const setFxRateSchema = z.object({
  nairaPerDollar: z
    .string()
    .min(1, 'Enter the rate')
    .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Naira per dollar, e.g. 1650 or 1650.50'),
});

export type SetFxRateValues = z.input<typeof setFxRateSchema>;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRACT MIRROR of tradewave-api/src/modules/admin/schemas.ts
 *
 * The same deliberate mismatch as the FX form: the API takes money as a string
 * of CENTS, this form takes DOLLARS. "2500000" and "250000" look alike at a
 * glance and one of them is a listing ten times too cheap, so the conversion
 * happens once, in property-form.tsx, right before submit — and the parsed
 * figure is echoed back first.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const dollarField = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .regex(/^[\d,]+(\.\d{1,2})?$/, `${label} must be an amount, e.g. 450000`);

export const propertyFormSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(3, 'At least 3 characters')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only'),
  title: z.string().trim().min(1, 'Title is required').max(120, 'At most 120 characters'),
  summary: z.string().trim().min(1, 'Summary is required').max(200, 'At most 200 characters'),
  description: z.string().trim().min(1, 'Description is required').max(4000),
  addressLine: z.string().trim().min(1, 'Address is required').max(200),
  area: z.string().trim().min(1, 'Area is required').max(100),
  city: z.string().trim().min(1, 'City is required').max(100),
  country: z.string().trim().length(2, 'Two-letter code, e.g. AE'),
  totalValue: dollarField('Property value'),
  minInvestment: dollarField('Minimum investment'),
  /** Percent as typed — 9.2 becomes 920 basis points on submit. */
  annualReturnPercent: z
    .string()
    .min(1, 'Return is required')
    .regex(/^\d{1,3}(\.\d{1,2})?$/, 'A percentage, e.g. 9.2'),
  termMonths: z
    .string()
    .min(1, 'Term is required')
    .regex(/^\d{1,3}$/, 'Whole months, e.g. 24'),
});

export type PropertyFormValues = z.input<typeof propertyFormSchema>;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRACT MIRROR of updateProfileSchema in
 * tradewave-api/src/modules/auth/schemas.ts
 *
 * Whether the NAME may actually change depends on identity-verification state,
 * which only the server knows. The form disables the inputs when it should, but
 * the API is what enforces it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const updateProfileSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'First name is required')
    .max(50, 'First name is too long')
    .regex(/^[\p{L}\p{M}'\- .]+$/u, 'First name contains invalid characters'),
  lastName: z
    .string()
    .trim()
    .min(1, 'Last name is required')
    .max(50, 'Last name is too long')
    .regex(/^[\p{L}\p{M}'\- .]+$/u, 'Last name contains invalid characters'),
  // Changeable, not clearable: it is required to register, so Settings must not
  // be able to leave an account in a state the signup form cannot produce.
  phone: z
    .string({ error: 'Phone number is required' })
    .trim()
    .min(1, 'Phone number is required')
    .regex(/^\+?[0-9\s\-()]{7,20}$/, 'Enter a valid phone number'),
});

export type UpdateProfileValues = z.input<typeof updateProfileSchema>;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRACT MIRROR of setPayoutAccountSchema in
 * tradewave-api/src/modules/wallet/schemas.ts
 *
 * Whether the account NAME is acceptable is decided server-side against the
 * verified identity — this only checks the shape.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const setPayoutAccountSchema = z.object({
  bankCode: z.string().min(1, 'Choose a bank'),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'A Nigerian account number is 10 digits'),
  accountName: z
    .string()
    .trim()
    .min(2, 'Enter the name on the account')
    .max(100, 'That name is too long'),
});

export type SetPayoutAccountValues = z.input<typeof setPayoutAccountSchema>;

/* ─────────────────────────────────────────────────────────────────────────────
 * CONTRACT MIRROR of changePasswordSchema in
 * tradewave-api/src/modules/auth/schemas.ts
 *
 * The breached-password check is server-side only — the list is large and it is
 * not worth shipping to a browser to fail a check the API repeats anyway. So a
 * password can pass here and still be refused, and the form has to surface
 * that field error rather than assume its own validation was the last word.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    password: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(128, 'Password is too long'),
    confirm: z.string().min(1, 'Confirm your new password'),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'These do not match',
    path: ['confirm'],
  })
  .refine((v) => v.currentPassword !== v.password, {
    message: 'That is the password you already have — choose a different one',
    path: ['password'],
  });

export type ChangePasswordValues = z.input<typeof changePasswordSchema>;
