import { Router, type Request, type Response } from 'express';
import { requireAuth, requireKyc } from '../../middleware/auth';
import { depositAccountLimiter, depositWebhookLimiter } from '../../middleware/rate-limit';
import { unauthorized } from '../../lib/errors';
import { paymentProvider } from '../../services/payments';
import { getWallet } from './wallet.service';
import {
  creditFromReference,
  getDepositAccount,
  reconcileDeposits,
} from './deposit.service';

export const walletRouter = Router();

/**
 * requireAuth only, not requireActive: an unverified user should still be able
 * to see an empty wallet rather than hit a 403 on their own dashboard.
 *
 * Sweeps for unseen deposits on the way through. Klasha's webhook is unsigned
 * and therefore never the sole path by which money is credited — see
 * deposit.service. The sweep is throttled internally and swallows its own
 * failures, so a provider outage cannot stop this page rendering.
 */
walletRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  if (!req.auth) throw unauthorized();
  await reconcileDeposits();
  res.json(await getWallet(req.auth.userId));
});

/**
 * The user's naira account details.
 *
 * requireKyc, not merely requireAuth: this is the point at which we would start
 * holding someone's money, and holding money for a person we cannot identify is
 * the thing identity verification exists to prevent. It is also the first route
 * in the codebase where requireKyc guards something a user can actually reach.
 */
walletRouter.get(
  '/deposit-account',
  requireAuth,
  requireKyc,
  depositAccountLimiter,
  async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    res.json(await getDepositAccount(req.auth.userId));
  },
);

/**
 * Provider callback. No auth — and, unlike the KYC webhook, no signature either:
 * Klasha does not sign these, so this endpoint is genuinely open.
 *
 * That is survivable only because of what it does NOT do. It reads a reference
 * out of the body and discards everything else, including the amount. The
 * credit is built from an authenticated read against the provider, so the worst
 * a forged request achieves is making us look up a transaction that either
 * exists already or does not exist at all.
 *
 * Always answers 200. Providers retry any non-2xx, so a 404 for a stale
 * reference becomes a retry storm, and an error body would tell a prober
 * whether their guess landed.
 */
walletRouter.post(
  '/deposits/webhook',
  depositWebhookLimiter,
  async (req: Request, res: Response) => {
    const reference = paymentProvider.parseWebhookReference(req.body);
    if (reference) await creditFromReference(reference);
    res.status(200).json({ received: true });
  },
);
