import { Router, type Request, type Response } from 'express';
import { requireActive, requireAuth, requireKyc } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { unauthorized } from '../../lib/errors';
import { createInvestment, getPortfolio } from './investment.service';
import { settleMaturedInvestments } from './maturity.service';
import { createInvestmentSchema, type CreateInvestmentInput } from './schemas';

export const investmentRouter = Router();

/**
 * Portfolio totals plus every holding, with accrual derived at request time.
 *
 * Settles anything that has come due on the way through. This is the read an
 * investor makes at exactly the moment they would notice a matured holding, so
 * hanging the sweep here means the money is spendable by the time the page
 * renders. It is throttled internally and swallows its own failures, so a
 * settlement problem cannot stop a portfolio loading.
 *
 * requireActive is deliberately NOT here. Seeing your own holdings is exactly
 * what a RESTRICTED investor must still be able to do — the freeze is on money
 * moving, not on knowing where it is.
 *
 * Also returns the server's clock. The portfolio ticks the accrued figure up
 * live in the browser, computed from the same four inputs this uses — so the
 * client needs our time rather than the device's, or a phone with a wrong clock
 * shows a number we would not pay.
 */
investmentRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  if (!req.auth) throw unauthorized();
  await settleMaturedInvestments();
  res.json({ ...(await getPortfolio(req.auth.userId)), serverTime: new Date().toISOString() });
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
