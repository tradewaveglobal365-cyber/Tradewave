import { Router, type Request, type Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { badRequest } from '../../lib/errors';
import * as service from './admin.service';

export const adminRouter = Router();

/**
 * Everything under /admin requires an ADMIN role, checked against the database
 * on every request rather than against the access token — see requireRole.
 * Applied once at the router rather than per route, so a new route added below
 * cannot be forgotten.
 */
adminRouter.use(requireAuth, requireRole('ADMIN'));

/** Recent deposits, newest first. */
adminRouter.get('/deposits', async (_req: Request, res: Response) => {
  res.json({ deposits: await service.listDeposits() });
});

/**
 * Re-runs the credit for one deposit.
 *
 * For money that landed before a rate was published and has since scrolled out
 * of the provider's recent-transactions window, which is the one case the
 * automatic sweep cannot reach.
 */
adminRouter.post('/deposits/:id/retry', async (req: Request, res: Response) => {
  // Express 5 types a param as string | string[], since a repeated segment can
  // produce an array. Narrowed rather than cast — an array here means the route
  // was matched in a way this handler does not understand.
  const id = req.params.id;
  if (typeof id !== 'string' || !id) throw badRequest('Deposit id is required.');
  res.json({ deposit: await service.retryDeposit(id) });
});
