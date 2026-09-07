import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { validationFailed } from '../lib/errors';

/** Express 5 makes req.query getter-only, so parsed values are stashed here. */
declare module 'express-serve-static-core' {
  interface Request {
    validatedQuery?: unknown;
  }
}

function toFieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

/**
 * Validates and REPLACES req.body with the parsed result, so downstream handlers
 * work with coerced, trimmed, known-shaped data rather than raw input.
 */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(validationFailed(toFieldErrors(result.error.issues)));
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(validationFailed(toFieldErrors(result.error.issues)));
    req.validatedQuery = result.data;
    next();
  };
}

/** Reads what validateQuery stashed. Only call it on a route that used it. */
export function query<T>(req: Request): T {
  return req.validatedQuery as T;
}
