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
import {
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
