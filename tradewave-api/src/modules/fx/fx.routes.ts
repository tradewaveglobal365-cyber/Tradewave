import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { badRequest, unauthorized } from '../../lib/errors';
import { getCurrentRate, InvalidRateError, setRate } from './fx.service';

export const fxRouter = Router();

/**
 * CONTRACT MIRROR — see tradewave-web/lib/schemas.ts.
 *
 * The rate is given in KOBO per dollar, as an integer string, for the reason
 * every other money value on this API is a string: a JSON number invites the
 * client to do arithmetic on it, and 165000 is small enough that someone would
 * eventually try.
 */
export const setRateSchema = z.object({
  minorPerUnit: z
    .string()
    .regex(/^\d+$/, 'Give the rate in whole kobo per dollar, e.g. 165000 for ₦1,650.00'),
  midMinorPerUnit: z.string().regex(/^\d+$/).optional(),
});

/** What a depositor is quoted. Readable by any signed-in user. */
fxRouter.get('/rate', requireAuth, async (_req: Request, res: Response) => {
  const rate = await getCurrentRate();
  res.json({
    baseCurrency: 'USD',
    quoteCurrency: 'NGN',
    minorPerUnit: rate ? rate.minorPerUnit.toString() : null,
    effectiveAt: rate?.effectiveAt ?? null,
  });
});

/**
 * Sets the customer rate. Admin only.
 *
 * Appends a row rather than updating one, so "what rate was this deposit
 * credited at, and who set it" stays answerable long after the fact.
 */
fxRouter.put(
  '/rate',
  requireAuth,
  requireRole('ADMIN'),
  validateBody(setRateSchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const body = req.body as z.infer<typeof setRateSchema>;

    try {
      const rate = await setRate({
        minorPerUnit: BigInt(body.minorPerUnit),
        midMinorPerUnit: body.midMinorPerUnit ? BigInt(body.midMinorPerUnit) : null,
        setByUserId: req.auth.userId,
      });
      res.status(201).json({
        baseCurrency: 'USD',
        quoteCurrency: 'NGN',
        minorPerUnit: rate.minorPerUnit.toString(),
        effectiveAt: rate.effectiveAt,
      });
    } catch (err) {
      if (err instanceof InvalidRateError) throw badRequest(err.message);
      throw err;
    }
  },
);
