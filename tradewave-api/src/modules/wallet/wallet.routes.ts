import { Router, type Request, type Response } from 'express';
import { requireAuth, requireKyc } from '../../middleware/auth';
import { logger } from '../../lib/logger';
import { validateBody } from '../../middleware/validate';
import {
  depositAccountLimiter,
  depositWebhookLimiter,
  withdrawalLimiter,
} from '../../middleware/rate-limit';
import { badRequest, banksUnavailable, unauthorized } from '../../lib/errors';
import { paymentProvider } from '../../services/payments';
import { getWallet } from './wallet.service';
import * as payout from './payout.service';
import {
  requestWithdrawalSchema,
  setPayoutAccountSchema,
  type RequestWithdrawalInput,
  type SetPayoutAccountInput,
} from './schemas';
import * as withdrawal from './withdrawal.service';
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
 * That is survivable only because of what it does NOT do. It reads a KIND and a
 * reference out of the body and discards everything else, including the amount.
 * The credit is built from an authenticated read against the provider, so the
 * worst a forged request achieves is making us look up a transaction that
 * either exists already or does not exist at all.
 *
 * ── The path name is historical ───────────────────────────────────────────
 * This receives EVERY Klasha event, not just deposits: they post collections,
 * payouts and refunds to one configured URL. The path still says /deposits
 * because it is the URL set in their dashboard and renaming it means
 * reconfiguring the integration for no gain.
 *
 * The dispatch below is on `kind` and nothing else. A payout event can only
 * ever reach settleFromWebhook; there is no path from one to a wallet credit,
 * which matters because money arriving and money leaving look similar enough
 * in these payloads to be confused by anything less explicit.
 *
 * Always answers 200. Providers retry any non-2xx, so a 404 for a stale
 * reference becomes a retry storm, and an error body would tell a prober
 * whether their guess landed.
 */
walletRouter.post(
  '/deposits/webhook',
  depositWebhookLimiter,
  async (req: Request, res: Response) => {
    const event = paymentProvider.parseWebhookEvent(req.body);
    if (event?.kind === 'collection') await creditFromReference(event.reference);
    else if (event?.kind === 'payout') {
      await withdrawal.settleFromWebhook(event.reference, event.state);
    }
    res.status(200).json({ received: true });
  },
);

// ── Payout account ──────────────────────────────────────────────────────────

/**
 * The banks a payout can go to. Needed to render the form, so requireAuth only.
 *
 * A provider failure is translated into 503 BANKS_UNAVAILABLE rather than
 * allowed to become a 500. The difference matters to the form at the other end:
 * an empty list and a failed request look the same in a <select>, and the user
 * is left staring at a dropdown with nothing in it and no idea why.
 */
walletRouter.get('/banks', requireAuth, async (_req: Request, res: Response) => {
  let banks;
  try {
    banks = await payout.listBanks();
  } catch (err) {
    logger.error({ err }, 'Could not load the bank list from the payment provider');
    throw banksUnavailable();
  }
  res.json({ banks });
});

walletRouter.get('/payout-account', requireAuth, async (req: Request, res: Response) => {
  if (!req.auth) throw unauthorized();
  res.json({ account: await payout.getPayoutAccount(req.auth.userId) });
});

/**
 * Set or replace the account money will be paid to.
 *
 * requireKyc is load-bearing rather than conventional: the account name is
 * checked against the VERIFIED identity, so without a passed check there is
 * nothing to check against.
 */
walletRouter.put(
  '/payout-account',
  requireAuth,
  requireKyc,
  validateBody(setPayoutAccountSchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const input = req.body as SetPayoutAccountInput;
    res.json({ account: await payout.setPayoutAccount(req.auth.userId, input) });
  },
);

// ── Withdrawals ─────────────────────────────────────────────────────────────

/**
 * Everything the withdraw screen needs: balance, destination, limits, the live
 * request and the history. One round trip, because which of the five states the
 * screen is in depends on all of them at once.
 */
walletRouter.get('/withdrawals', requireAuth, async (req: Request, res: Response) => {
  if (!req.auth) throw unauthorized();
  res.json(await withdrawal.getWithdrawalContext(req.auth.userId));
});

/**
 * Ask for money to be sent out.
 *
 * requireKyc for the same reason the payout account needs it: we only ever pay
 * an account that matches a verified identity, and an unverified user has no
 * such account to pay.
 *
 * POST rather than PUT — PUT is missing from the CORS methods allowlist in
 * app.ts and only works today because the browser goes through the Next.js
 * same-origin rewrite.
 */
walletRouter.post(
  '/withdrawals',
  requireAuth,
  requireKyc,
  withdrawalLimiter,
  validateBody(requestWithdrawalSchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const { amountCents } = req.body as RequestWithdrawalInput;
    res
      .status(201)
      .json({ withdrawal: await withdrawal.requestWithdrawal(req.auth.userId, amountCents) });
  },
);

/** Changing their mind, while nothing has been sent. */
walletRouter.post(
  '/withdrawals/:id/cancel',
  requireAuth,
  async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const id = req.params.id;
    if (typeof id !== 'string' || !id) throw badRequest('An id is required.');
    res.json({ withdrawal: await withdrawal.cancelWithdrawal(req.auth.userId, id) });
  },
);
