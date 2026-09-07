import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { query, validateQuery } from '../../middleware/validate';
import { unauthorized } from '../../lib/errors';
import { referralCodePattern } from '../../lib/crypto';
import * as service from './referral.service';

export const referralRouter = Router();

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

referralRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  if (!req.auth) throw unauthorized();
  res.json(await service.getSummary(req.auth.userId));
});

referralRouter.get(
  '/list',
  requireAuth,
  validateQuery(listQuerySchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const { page, perPage } = query<z.infer<typeof listQuerySchema>>(req);
    res.json(await service.listReferrals(req.auth.userId, page, perPage));
  },
);

/** Public — the signup form calls this before the user has an account. */
referralRouter.get('/validate/:code', async (req: Request, res: Response) => {
  const code = String(req.params.code ?? '').trim().toUpperCase();
  if (!referralCodePattern.test(code)) {
    res.json({ valid: false });
    return;
  }
  res.json(await service.validateCode(code));
});
