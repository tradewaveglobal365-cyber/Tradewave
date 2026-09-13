import { Router, type Request, type Response } from 'express';
import { requireActive, requireAuth, requireKyc } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { unauthorized } from '../../lib/errors';
import { createInvestment, getPortfolio } from './investment.service';
import { createInvestmentSchema, type CreateInvestmentInput } from './schemas';

export const investmentRouter = Router();

/** Portfolio totals plus every holding, with accrual derived at request time. */
investmentRouter.get('/', requireAuth, requireActive, async (req: Request, res: Response) => {
  if (!req.auth) throw unauthorized();
  res.json(await getPortfolio(req.auth.userId));
});

export const investmentActionRouter = Router();

/**
 * Buys a fractional stake.
 *
 * Two independent gates. requireActive reads UserStatus (is the account usable at
 * all); requireKyc reads kycStatus (have we established who this person is). They
 * are deliberately separate fields — a user can be ACTIVE and un-verified, and one
 * enum cannot hold both. requireKyc also reads the database rather than the JWT,
 * because a 15-minute token would leave someone who just passed verification
 * blocked at the exact moment they try to act on it.
 */
investmentActionRouter.post(
  '/',
  requireAuth,
  requireActive,
  requireKyc,
  validateBody(createInvestmentSchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const { propertyId, amountCents } = req.body as CreateInvestmentInput;
    const result = await createInvestment(req.auth.userId, propertyId, amountCents);
    res.status(201).json({
      investment: { id: result.investment.id, maturesAt: result.investment.maturesAt },
      balanceCents: result.balanceAfterCents,
    });
  },
);
