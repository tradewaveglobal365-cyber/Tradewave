import { Router, type Request, type Response } from 'express';
import { requireActive, requireAuth } from '../../middleware/auth';
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
 * Buys a fractional stake. requireActive gates on UserStatus, which is exactly
 * where the KYC check will slot in later — no new gating concept needed.
 */
investmentActionRouter.post(
  '/',
  requireAuth,
  requireActive,
  validateBody(createInvestmentSchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const { propertyId, amountFils } = req.body as CreateInvestmentInput;
    const result = await createInvestment(req.auth.userId, propertyId, amountFils);
    res.status(201).json({
      investment: { id: result.investment.id, maturesAt: result.investment.maturesAt },
      balanceFils: result.balanceAfterFils,
    });
  },
);
