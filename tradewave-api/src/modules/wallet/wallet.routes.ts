import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { unauthorized } from '../../lib/errors';
import { getWallet } from './wallet.service';

export const walletRouter = Router();

/**
 * requireAuth only, not requireActive: an unverified user should still be able
 * to see an empty wallet rather than hit a 403 on their own dashboard.
 */
walletRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  if (!req.auth) throw unauthorized();
  res.json(await getWallet(req.auth.userId));
});
