import { z } from 'zod';

/**
 * CONTRACT MIRROR — see tradewave-web/lib/schemas.ts.
 *
 * NIN is the only document accepted today. The field is named generically because
 * DocumentType already carries PASSPORT and EMIRATES_ID, and adding one means
 * widening this union rather than reshaping the request.
 */
export const submitKycSchema = z.object({
  documentType: z.literal('NIN', { error: 'Select a document type' }),
  documentNumber: z
    .string({ error: 'Enter your NIN' })
    .trim()
    .regex(/^\d{11}$/, 'A NIN is exactly 11 digits'),
});

export type SubmitKycInput = z.infer<typeof submitKycSchema>;
