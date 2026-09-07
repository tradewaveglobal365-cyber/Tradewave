import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { kycSubmitLimiter } from '../../middleware/rate-limit';
import { unauthorized } from '../../lib/errors';
import { submitKycSchema } from './schemas';
import * as service from './kyc.service';

export const kycRouter = Router();

/**
 * requireAuth only, not requireActive: identity verification is itself a setup
 * step, so someone still working through the checklist must be able to reach it.
 */
kycRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  if (!req.auth) throw unauthorized();
  res.json(await service.getStatus(req.auth.userId));
});

/**
 * kycSubmitLimiter is mounted AFTER requireAuth on purpose — it keys on the
 * authenticated user id, which does not exist before that runs.
 */
kycRouter.post(
  '/submit',
  requireAuth,
  kycSubmitLimiter,
  validateBody(submitKycSchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    res.status(201).json(await service.submit(req.auth.userId, req.body));
  },
);
