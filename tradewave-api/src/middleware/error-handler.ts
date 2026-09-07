import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { isProduction } from '../config/env';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Cannot ${req.method} ${req.path}` },
  });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, err.message);
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.fields ? { fields: err.fields } : {}),
      },
    });
    return;
  }

  // Anything unrecognised is a bug. Log it in full, tell the client nothing —
  // stack traces and driver errors leak schema details.
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our end. Please try again.',
      ...(isProduction ? {} : { detail: err instanceof Error ? err.message : String(err) }),
    },
  });
}
