import { z } from 'zod';

/**
 * CONTRACT MIRROR — see tradewave-web/lib/types.ts.
 *
 * Money arrives as a STRING of cents, never a JSON number. A number would be
 * silently coerced through a float on the way in, which is the exact drift the
 * money layer exists to prevent.
 */
export const createInvestmentSchema = z.object({
  propertyId: z.uuid('Select a property'),
  amountCents: z
    .string({ error: 'Enter an amount' })
    .regex(/^\d+$/, 'Amount must be a whole number of cents')
    .transform((v) => BigInt(v))
    .refine((v) => v > 0n, 'Amount must be greater than zero'),
});

export type CreateInvestmentInput = z.infer<typeof createInvestmentSchema>;
