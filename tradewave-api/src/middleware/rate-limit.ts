import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { isTest } from '../config/env';

/**
 * Rate limits are stored in memory, which is correct for a single instance but
 * resets on deploy and is not shared across replicas. Move to the Redis store
 * before running more than one API instance.
 */
function limiter(opts: Partial<Options> & { windowMs: number; limit: number }) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Limits would otherwise leak across test cases and cause phantom failures.
    skip: () => isTest,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many attempts. Please wait a moment and try again.',
        },
      });
    },
    ...opts,
  });
}

/**
 * Keys on the submitted email so one attacker cannot lock out a whole office NAT.
 *
 * The IP fallback must go through ipKeyGenerator: it normalises IPv6 to a /64
 * subnet, otherwise a client with a v6 prefix gets a fresh bucket per address
 * and the limit is trivially bypassed.
 */
const byEmail = (req: Request): string => {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email === 'string' && email.trim()) return `email:${email.toLowerCase().trim()}`;
  return `ip:${ipKeyGenerator(req.ip ?? '0.0.0.0')}`;
};

export const registerLimiter = limiter({ windowMs: 60 * 60 * 1000, limit: 5 });

export const loginLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 10 });

export const forgotPasswordLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyGenerator: byEmail,
});

export const resendVerificationLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyGenerator: byEmail,
});

/** Broad backstop for everything else. */
export const globalLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 300 });
