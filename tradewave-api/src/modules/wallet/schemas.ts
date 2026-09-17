import { z } from 'zod';

/**
 * CONTRACT MIRROR — see tradewave-web/lib/schemas.ts.
 */
export const setPayoutAccountSchema = z.object({
  bankCode: z.string().trim().min(1, 'Choose a bank'),
  // NUBAN is exactly ten digits. Constrained rather than sanitised: a number
  // that is nearly right is a payout to somebody else's account.
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

export type SetPayoutAccountInput = z.infer<typeof setPayoutAccountSchema>;

/**
 * CONTRACT MIRROR — see tradewave-web/lib/schemas.ts.
 *
 * Cents as a STRING, the same idiom as createInvestmentSchema. A JSON number
 * would invite a float round-trip on a value that has to stay exact.
 */
export const requestWithdrawalSchema = z.object({
  amountCents: z
    .string({ error: 'Enter an amount' })
    .regex(/^\d+$/, 'Amount must be a whole number of cents')
    .transform((v) => BigInt(v))
    .refine((v) => v > 0n, 'Amount must be greater than zero'),
});

export type RequestWithdrawalInput = z.infer<typeof requestWithdrawalSchema>;

export const rejectWithdrawalSchema = z.object({
  // Required, and it reaches the investor in the email. "Rejected" with no
  // reason is a support ticket somebody has to answer anyway.
  reason: z
    .string()
    .trim()
    .min(3, 'Say why, briefly — the investor is told this')
    .max(300, 'That is too long'),
});

export const markPaidSchema = z.object({
  note: z.string().trim().max(300, 'That is too long').optional(),
});

/**
 * CONTRACT MIRROR — see tradewave-web/lib/schemas.ts.
 *
 * Times are minutes from midnight rather than "HH:MM" strings: the server has
 * to do arithmetic with them, and parsing a time format is one more place for
 * a silent off-by-an-hour. The form renders the picker.
 */
export const setWithdrawalWindowSchema = z.object({
  /** Stops every withdrawal for everybody, whatever the schedule says. */
  paused: z.boolean().default(false),
  pausedReason: z.string().trim().max(300, 'That is too long').optional(),
  enabled: z.boolean(),
  daysOfWeek: z
    .array(z.number().int().min(0, 'Invalid day').max(6, 'Invalid day'))
    .max(7, 'That is more days than a week has'),
  opensAtMinute: z.number().int().min(0).max(1_439),
  closesAtMinute: z.number().int().min(1).max(1_440),
  timezone: z.string().trim().min(1, 'Choose a timezone'),
});

export type SetWithdrawalWindowInput = z.infer<typeof setWithdrawalWindowSchema>;
