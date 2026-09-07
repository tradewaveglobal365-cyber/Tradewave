import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { forbidden } from '../lib/errors';
import { logger } from '../lib/logger';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const allowedOrigins = new Set([env.WEB_ORIGIN]);

/**
 * CSRF defence.
 *
 * Because auth lives in cookies the browser attaches them automatically, so a
 * form on another site could otherwise POST to this API as the logged-in user.
 * SameSite=Lax blocks the cross-site case; this check covers the rest by
 * rejecting any state-changing request that does not declare our own origin.
 *
 * Requests with no Origin header at all (curl, server-to-server, mobile) are
 * allowed through — they are not browser-driven, so they carry no ambient
 * cookie authority to abuse.
 */
export function originCheck(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin) return next();

  if (!allowedOrigins.has(origin)) {
    logger.warn({ origin, path: req.path, ip: req.ip }, 'Blocked cross-origin state change');
    return next(forbidden('Request origin is not allowed.'));
  }

  next();
}

export { allowedOrigins };
