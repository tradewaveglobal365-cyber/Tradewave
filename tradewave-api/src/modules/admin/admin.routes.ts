import express, { Router, type Request, type Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { badRequest, storageUnavailable } from '../../lib/errors';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  StorageError,
  isStorageConfigured,
  uploadPropertyImage,
} from '../../services/storage';
import * as service from './admin.service';
import * as investors from './investor.service';
import * as properties from './property-admin.service';
import * as withdrawals from './withdrawal-admin.service';
import * as withdrawal from '../wallet/withdrawal.service';
import {
  markPaidSchema,
  rejectWithdrawalSchema,
  setWithdrawalWindowSchema,
  type SetWithdrawalWindowInput,
} from '../wallet/schemas';
import * as window from '../wallet/withdrawal-window.service';
import * as maturity from '../investment/maturity.service';
import * as account from './account.service';
import {
  accountStatusSchema,
  adjustBalanceSchema,
  reasonOnlySchema,
  withdrawalBlockSchema,
  type AccountStatusInput,
  type AdjustBalanceInput,
  type ReasonOnlyInput,
  type WithdrawalBlockInput,
  createPropertySchema,
  propertyStatusSchema,
  updatePropertySchema,
  type CreatePropertyInput,
  type UpdatePropertyInput,
} from './schemas';

export const adminRouter = Router();

/**
 * Everything under /admin requires an ADMIN role, checked against the database
 * on every request rather than against the access token — see requireRole.
 * Applied once at the router rather than per route, so a new route added below
 * cannot be forgotten.
 */
adminRouter.use(requireAuth, requireRole('ADMIN'));

/** Express 5 types a param as string | string[]; narrow rather than cast. */
function id(req: Request): string {
  const value = req.params.id;
  if (typeof value !== 'string' || !value) throw badRequest('An id is required.');
  return value;
}

// ── Deposits ────────────────────────────────────────────────────────────────

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
  res.json({ deposit: await service.retryDeposit(id(req)) });
});

// ── Withdrawals ─────────────────────────────────────────────────────────────

/**
 * The payout schedule.
 *
 * A setting rather than a constant because the first public holiday or bank
 * outage that lands on payout day needs moving that morning, not next release.
 */
adminRouter.get('/withdrawal-window', async (_req: Request, res: Response) => {
  const current = await window.getWindow();
  res.json({ window: current, state: window.evaluateWindow(current) });
});

adminRouter.post(
  '/withdrawal-window',
  validateBody(setWithdrawalWindowSchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw badRequest('Not signed in.');
    const input = req.body as SetWithdrawalWindowInput;
    const saved = await window.setWindow(input, req.auth.userId);
    res.json({ window: saved, state: window.evaluateWindow(saved) });
  },
);

/**
 * The queue, swept on the way through.
 *
 * The sweep hangs off this read rather than the investor's wallet for the same
 * reason the deposit one hangs off theirs: it belongs where the person who
 * cares about stuck money will actually trigger it. It is throttled internally
 * and swallows its own failures, so a provider outage cannot stop the queue
 * rendering.
 */
adminRouter.get('/withdrawals', async (_req: Request, res: Response) => {
  await withdrawal.reconcileWithdrawals();
  res.json({ withdrawals: await withdrawals.listWithdrawals() });
});

/** Releases the money: pins the rate and asks the provider to send it. */
adminRouter.post('/withdrawals/:id/approve', async (req: Request, res: Response) => {
  if (!req.auth) throw badRequest('Not signed in.');
  res.json({ withdrawal: await withdrawal.approveWithdrawal(id(req), req.auth.userId) });
});

/** Refuses it and returns the money, with a reason the investor is told. */
adminRouter.post(
  '/withdrawals/:id/reject',
  validateBody(rejectWithdrawalSchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw badRequest('Not signed in.');
    const { reason } = req.body as { reason: string };
    res.json({
      withdrawal: await withdrawal.rejectWithdrawal(id(req), req.auth.userId, reason),
    });
  },
);

/**
 * The manual rail: paid from a bank app rather than through the provider.
 *
 * Exists because the provider can be unreachable for reasons that have nothing
 * to do with the investor — an IP allowlist, an empty float — and somebody
 * waiting for their own money should not have to wait for that to be sorted.
 */
adminRouter.post(
  '/withdrawals/:id/mark-paid',
  validateBody(markPaidSchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw badRequest('Not signed in.');
    const { note } = req.body as { note?: string };
    res.json({
      withdrawal: await withdrawal.markWithdrawalPaid(id(req), req.auth.userId, note),
    });
  },
);

// ── Maturities ──────────────────────────────────────────────────────────────

/**
 * What is coming due, and anything overdue.
 *
 * Settlement runs off page loads rather than a cron, so this screen is what
 * makes a quiet week visible: without it, "nobody has logged in for four days"
 * and "settlement is broken" look identical from the outside.
 */
adminRouter.get('/maturities', async (_req: Request, res: Response) => {
  await maturity.settleMaturedInvestments();
  res.json({ maturities: await maturity.listUpcomingMaturities() });
});

/** Forces one, for when something is overdue and nobody wants to wait. */
adminRouter.post('/maturities/:id/settle', async (req: Request, res: Response) => {
  const settled = await maturity.settleInvestment(id(req));
  if (!settled) throw badRequest('That investment is not due, or has already been settled.');
  res.json({
    settled: {
      investmentId: settled.investmentId,
      principalCents: settled.principalCents.toString(),
      returnCents: settled.returnCents.toString(),
      totalCents: settled.totalCents.toString(),
    },
  });
});

// ── Account controls ────────────────────────────────────────────────────────

/**
 * Doing things to an investor's account.
 *
 * Every route takes a mandatory reason, and every one writes an AdminAction.
 * POST throughout rather than PATCH or PUT — PUT is missing from the CORS
 * methods allowlist in app.ts, and these are events rather than edits: what
 * happened and why is the record, not the resulting field value.
 */
adminRouter.post(
  '/investors/:id/status',
  validateBody(accountStatusSchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw badRequest('Not signed in.');
    const { action, reason } = req.body as AccountStatusInput;
    res.json(
      await account.setAccountStatus({
        actorId: req.auth.userId,
        subjectId: id(req),
        action,
        reason,
      }),
    );
  },
);

adminRouter.post(
  '/investors/:id/withdrawals',
  validateBody(withdrawalBlockSchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw badRequest('Not signed in.');
    const { action, reason } = req.body as WithdrawalBlockInput;
    res.json(
      await account.setWithdrawalBlock({
        actorId: req.auth.userId,
        subjectId: id(req),
        action,
        reason,
      }),
    );
  },
);

adminRouter.post(
  '/investors/:id/kyc-reset',
  validateBody(reasonOnlySchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw badRequest('Not signed in.');
    const { reason } = req.body as ReasonOnlyInput;
    res.json(
      await account.forceKycReverification({
        actorId: req.auth.userId,
        subjectId: id(req),
        reason,
      }),
    );
  },
);

adminRouter.post(
  '/investors/:id/verify-email',
  validateBody(reasonOnlySchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw badRequest('Not signed in.');
    const { reason } = req.body as ReasonOnlyInput;
    res.json(
      await account.markEmailVerified({
        actorId: req.auth.userId,
        subjectId: id(req),
        reason,
      }),
    );
  },
);

/** The only route in the product that creates or destroys money outright. */
adminRouter.post(
  '/investors/:id/adjust-balance',
  validateBody(adjustBalanceSchema),
  async (req: Request, res: Response) => {
    if (!req.auth) throw badRequest('Not signed in.');
    const { amountCents, reason } = req.body as AdjustBalanceInput;
    res.json(
      await account.adjustBalance({
        actorId: req.auth.userId,
        subjectId: id(req),
        amountCents,
        reason,
      }),
    );
  },
);

// ── Investors ────────────────────────────────────────────────────────────────

/**
 * Paged, because the number of users is not bounded by anything the way the
 * deposit list is. An unparseable page number falls back to the first page
 * rather than erroring — a bad query string is not worth a 400 on a read.
 */
adminRouter.get('/investors', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const parsed = Number(req.query.page);
  const page = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
  res.json(await investors.listInvestors({ q, page }));
});

/**
 * Verifications waiting on a human. Read-only: the decision is taken in the
 * provider's console, which has the document scan and the selfie this server
 * deliberately never receives.
 */
adminRouter.get('/identity/reviews', async (_req: Request, res: Response) => {
  res.json({ reviews: await investors.listPendingReviews() });
});

adminRouter.get('/investors/:id', async (req: Request, res: Response) => {
  res.json({ investor: await investors.getInvestor(id(req)) });
});

// ── Properties ──────────────────────────────────────────────────────────────

adminRouter.get('/properties', async (_req: Request, res: Response) => {
  res.json({ properties: await properties.listProperties() });
});

adminRouter.get('/properties/:id', async (req: Request, res: Response) => {
  res.json({ property: await properties.getProperty(id(req)) });
});

adminRouter.post(
  '/properties',
  validateBody(createPropertySchema),
  async (req: Request, res: Response) => {
    const input = req.body as CreatePropertyInput;
    res.status(201).json({ property: await properties.createProperty(input) });
  },
);

adminRouter.patch(
  '/properties/:id',
  validateBody(updatePropertySchema),
  async (req: Request, res: Response) => {
    const input = req.body as UpdatePropertyInput;
    res.json({ property: await properties.updateProperty(id(req), input) });
  },
);

adminRouter.post(
  '/properties/:id/status',
  validateBody(propertyStatusSchema),
  async (req: Request, res: Response) => {
    const { action } = req.body as { action: properties.StatusAction };
    res.json({ property: await properties.setStatus(id(req), action) });
  },
);

// ── Image upload ────────────────────────────────────────────────────────────

/**
 * Takes the raw file bytes, stores them, and returns the URL to save.
 *
 * express.raw is mounted HERE rather than globally: the app-wide parser caps
 * JSON at 100kb, and widening that for every route to accommodate one upload
 * would be the wrong trade. The type list also means anything that is not an
 * allowed image never reaches a Buffer at all — req.body stays empty and the
 * check below rejects it.
 *
 * Not tied to a property id, so a listing can have photographs chosen before it
 * has been saved for the first time.
 */
adminRouter.post(
  '/uploads/property-image',
  express.raw({ type: [...ALLOWED_IMAGE_TYPES], limit: MAX_IMAGE_BYTES }),
  async (req: Request, res: Response) => {
    // Validate the REQUEST before reporting on the server's configuration. A
    // client sending a PDF should be told their request is wrong whether or not
    // storage happens to be set up — and the order keeps the response
    // deterministic rather than dependent on deployment state.
    const contentType = req.headers['content-type']?.split(';')[0]?.trim() ?? '';
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw badRequest('Send the image as the request body, as JPEG, PNG or WebP.');
    }
    if (!isStorageConfigured()) {
      throw storageUnavailable();
    }

    try {
      const url = await uploadPropertyImage(req.body, contentType);
      res.status(201).json({ url });
    } catch (err) {
      if (err instanceof StorageError) throw badRequest(err.message);
      throw err;
    }
  },
);
