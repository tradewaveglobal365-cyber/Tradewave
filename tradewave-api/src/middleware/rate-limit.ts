import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { isTest } from '../config/env';
import { normalizePhone } from '../lib/phone';

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
 * Keys on the submitted account identifier so one attacker cannot lock out a
 * whole office NAT.
 *
 * Reads `identifier` first and `email` second: /auth/forgot-password takes
 * either an address or a phone number under `identifier`, while
 * /auth/resend-verification is still email-only and lands on the second
 * branch.
 *
 * A phone number is NORMALISED before it becomes a key. This runs before
 * validateBody, so what arrives is raw — and without normalising, 0803 000 0000,
 * +2348030000000 and 234-803-000-0000 are three buckets against one account,
 * which multiplies a 3-per-hour reset limit by however many spellings somebody
 * can be bothered to type.
 *
 * The IP fallback must go through ipKeyGenerator: it normalises IPv6 to a /64
 * subnet, otherwise a client with a v6 prefix gets a fresh bucket per address
 * and the limit is trivially bypassed.
 */
const byIdentifier = (req: Request): string => {
  const body = req.body as { identifier?: unknown; email?: unknown } | undefined;
  const raw = typeof body?.identifier === 'string' ? body.identifier : body?.email;

  if (typeof raw === 'string' && raw.trim()) {
    const value = raw.trim().toLowerCase();
    return `id:${value.includes('@') ? value : (normalizePhone(value) ?? value)}`;
  }
  return `ip:${ipKeyGenerator(req.ip ?? '0.0.0.0')}`;
};

/**
 * Keys on the signed-in user, for limiters mounted after requireAuth.
 *
 * The IP fallback exists only for a request that somehow reaches one of these
 * before auth has run, and it goes through ipKeyGenerator for exactly the
 * reason byIdentifier does: keying on a raw IPv6 address hands every client in a /64
 * its own bucket, so the limit is bypassed by picking a new address. Writing
 * `req.ip` here directly is what express-rate-limit warns about at boot.
 */
const byUser = (req: Request): string =>
  req.auth?.userId ?? `ip:${ipKeyGenerator(req.ip ?? '0.0.0.0')}`;

export const registerLimiter = limiter({ windowMs: 60 * 60 * 1000, limit: 5 });

export const loginLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 10 });

export const forgotPasswordLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyGenerator: byIdentifier,
});

export const resendVerificationLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyGenerator: byIdentifier,
});

/** Broad backstop for everything else. */
/**
 * Identity checks cost real money per call. This is the coarse front line; the
 * cap that actually binds lives in modules/kyc/kyc.service.ts, because this
 * limiter is memory-backed and skipped under test.
 *
 * Keys on the authenticated user, so it MUST be mounted after requireAuth.
 */
export const kycSubmitLimiter = limiter({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 5,
  keyGenerator: byUser,
});

/**
 * Generous and IP-keyed: providers retry hard and can burst. The real protection
 * on this route is the HMAC signature, not the limiter.
 */
export const kycWebhookLimiter = limiter({ windowMs: 60 * 1000, limit: 120 });

export const globalLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 300 });

/**
 * Provisioning a deposit account is a call to the payment provider, so this is
 * tighter than an ordinary read. The account is cached after the first success,
 * making repeated misses the only thing this needs to absorb.
 */
export const depositAccountLimiter = limiter({ windowMs: 60 * 1000, limit: 20 });

/**
 * Klasha's webhook carries no signature, so this endpoint is genuinely open —
 * anyone can POST to it. The limit is what stops that being free: each request
 * costs us an authenticated lookup against the provider.
 */
export const depositWebhookLimiter = limiter({ windowMs: 60 * 1000, limit: 120 });

/**
 * Asking for money to be sent out.
 *
 * Tight, and keyed on the authenticated user rather than the IP — so it MUST be
 * mounted after requireAuth. The service already refuses a second withdrawal
 * while one is live, so anything above a handful an hour is somebody probing
 * the balance guard rather than an investor changing their mind.
 */
export const withdrawalLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: byUser,
});

/**
 * Changing a password while signed in.
 *
 * Keyed on the user, so it MUST be mounted after requireAuth. The limit is
 * about the CURRENT password field rather than the new one: without it, someone
 * with a stolen session could guess their way to the account owner's password
 * at their leisure, and the login limiter would never see the attempts.
 */
export const changePasswordLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: byUser,
});
