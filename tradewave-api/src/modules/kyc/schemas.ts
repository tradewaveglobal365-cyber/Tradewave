import { z } from 'zod';

/**
 * CONTRACT MIRROR — see tradewave-web/lib/schemas.ts.
 *
 * No document fields: the user does not type an ID number any more. They consent,
 * we hand them to the provider, and the provider extracts the document itself.
 * Consent is recorded because the check is a biometric one.
 */
export const submitKycSchema = z.object({
  consent: z
    .boolean()
    .refine((v) => v, 'You need to agree before we can verify your identity'),
});

export type SubmitKycInput = z.infer<typeof submitKycSchema>;
