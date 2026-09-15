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
