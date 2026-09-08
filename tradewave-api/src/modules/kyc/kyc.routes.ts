import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { kycSubmitLimiter, kycWebhookLimiter } from '../../middleware/rate-limit';
import { unauthorized } from '../../lib/errors';
import { submitKycSchema } from './schemas';
import { kycProvider } from '../../services/kyc';
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
    res.status(201).json(await service.submit(req.auth.userId));
  },
);

/**
 * Provider callback. No requireAuth — this is server-to-server and carries no
 * session; the HMAC signature is the authentication.
 *
 * Always answers 200, even for an unknown or unsigned payload. Providers retry
 * any non-2xx indefinitely, so a 404 for a stale session becomes a retry storm,
 * and an error body would tell an attacker whether their guess landed.
 *
 * Needs no raw-body handling: the signature covers canonicalised JSON precisely
 * so it survives express.json(). See services/kyc/didit.ts.
 */
kycRouter.post('/webhook', kycWebhookLimiter, async (req: Request, res: Response) => {
  const decision = kycProvider.parseWebhook(req.body, req.headers);
  if (decision) await service.applyDecision(decision);
  res.status(200).json({ received: true });
});
