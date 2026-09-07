import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { query, validateQuery } from '../../middleware/validate';
import * as service from './property.service';

export const propertyRouter = Router();

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(12),
});

/** Public — the browse grid is visible before a visitor has an account. */
propertyRouter.get(
  '/',
  validateQuery(listQuerySchema),
  async (req: Request, res: Response) => {
    const { page, perPage } = query<z.infer<typeof listQuerySchema>>(req);
    res.json(await service.listProperties(page, perPage));
  },
);

propertyRouter.get('/:slug', async (req: Request, res: Response) => {
  res.json({ property: await service.getPropertyBySlug(String(req.params.slug)) });
});
