import { z } from 'zod';

/**
 * CONTRACT MIRROR — see tradewave-web/lib/schemas.ts.
 *
 * Money arrives as a STRING of cents, never a JSON number, for the reason
 * lib/money.ts exists: a number invites the client to do arithmetic on it, and
 * a property value in cents is large enough to start losing precision.
 */
const cents = z
  .string()
  .regex(/^\d+$/, 'Give a whole number of cents')
  .transform((v) => BigInt(v));

/**
 * Lowercase, hyphenated, no leading or trailing hyphen. This becomes the public
 * URL of the listing, so it is constrained rather than sanitised — silently
 * rewriting what someone typed makes the address they see and the address they
 * get disagree.
 */
const slug = z
  .string()
  .trim()
  .min(3, 'At least 3 characters')
  .max(80, 'At most 80 characters')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Lowercase letters, numbers and single hyphens only',
  );

const text = (max: number, label: string) =>
  z.string().trim().min(1, `${label} is required`).max(max, `At most ${max} characters`);

/**
 * The fields, WITHOUT defaults.
 *
 * Defaults live on the create schema alone, deliberately. Deriving the update
 * schema from a create schema that carries `.default([])` means a PATCH which
 * never mentions `images` still arrives carrying an empty array — and silently
 * deletes every photograph on the listing. The same trap applies to `country`
 * and `fundingClosesAt`. Two schemas, one field list.
 */
const fields = {
  slug,
  title: text(120, 'Title'),
  summary: text(200, 'Summary'),
  description: text(4000, 'Description'),
  addressLine: text(200, 'Address'),
  area: text(100, 'Area'),
  city: text(100, 'City'),
  country: z.string().trim().length(2, 'Two-letter country code'),
  images: z.array(z.string().url('Each image must be a URL')).max(12),
  totalValueCents: cents,
  minInvestmentCents: cents,
  // 1 = 0.01%. Capped at 100% a year: anything above that is a typo, and an
  // investment platform advertising it is a different kind of problem.
  annualReturnBps: z.number().int().min(1).max(10_000),
  termMonths: z.number().int().min(1).max(600),
  fundingClosesAt: z.coerce.date().nullable(),
};

export const createPropertySchema = z.object({
  ...fields,
  country: fields.country.default('AE'),
  // A listing with no photograph can be SAVED as a draft — writing the copy
  // first is a reasonable way to work — but setStatus refuses to publish it.
  images: fields.images.default([]),
  fundingClosesAt: fields.fundingClosesAt.default(null),
});

/** Every field optional and no defaults — the form sends only what changed. */
export const updatePropertySchema = z.object(fields).partial();

export const propertyStatusSchema = z.object({
  action: z.enum(['publish', 'close', 'unpublish']),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
