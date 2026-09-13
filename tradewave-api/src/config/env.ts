import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment variable the API reads is declared here and parsed once at
 * boot. Nothing else in the codebase should touch `process.env` — that way a
 * missing variable is a loud startup failure instead of an `undefined` that
 * surfaces as a broken login three days later.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required'),

  // openssl rand -base64 48
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters'),

  // Empty string selects the console email driver (see services/email).
  RESEND_API_KEY: z.string().default(''),
  // No default on purpose: the sending address is deployment-specific, so a
  // missing EMAIL_FROM should fail loudly at boot rather than silently send
  // from whatever address happened to be committed.
  EMAIL_FROM: z.string().min(1, 'EMAIL_FROM is required'),

  // Empty string selects the stub identity driver (see services/kyc). Set once a
  // provider contract exists; until then submissions queue as PENDING in prod.
  // All three together select the Didit driver; any missing and the stub stays.
  // See services/kyc/index.ts, mirroring how RESEND_API_KEY selects its driver.
  DIDIT_API_KEY: z.string().default(''),
  DIDIT_WORKFLOW_ID: z.string().default(''),
  DIDIT_WEBHOOK_SECRET: z.string().default(''),
  // Server-side pepper for hashing government ID numbers. An 11-digit NIN has too
  // little entropy to survive an unkeyed hash, so this secret is what stands
  // between a database dump and every user's ID number. See lib/crypto.
  KYC_ID_PEPPER: z.string().default(''),

  // Klasha — naira collection accounts. All five together select the real
  // driver; any missing and the stub stays. See services/payments/index.ts.
  //
  // The bearer token is minted from an ACCOUNT email and password rather than a
  // machine credential, which is Klasha's design and not a good one: these are
  // dashboard login credentials sitting in deployment config. Ask them for a
  // scoped API credential before this goes anywhere near real money.
  KLASHA_BASE_URL: z.string().default('https://dev.kcookery.com'),
  KLASHA_PUBLIC_KEY: z.string().default(''),
  KLASHA_ENCRYPTION_KEY: z.string().default(''),
  KLASHA_ACCOUNT_EMAIL: z.string().default(''),
  KLASHA_ACCOUNT_PASSWORD: z.string().default(''),

  WEB_ORIGIN: z.string().url(),
  // Empty in development; ".tradewave.com" in production so the cookie is
  // shared between tradewave.com and api.tradewave.com.
  COOKIE_DOMAIN: z.string().default(''),
});

const parsed = envSchema
  .superRefine((cfg, ctx) => {
    // Half-configured is worse than unconfigured: sessions would start and no
    // decision could ever be verified, stranding users on "under review".
    const didit = [cfg.DIDIT_API_KEY, cfg.DIDIT_WORKFLOW_ID, cfg.DIDIT_WEBHOOK_SECRET];
    if (didit.some(Boolean) && !didit.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DIDIT_API_KEY'],
        message:
          'DIDIT_API_KEY, DIDIT_WORKFLOW_ID and DIDIT_WEBHOOK_SECRET must all be set together, or all left empty',
      });
    }
    // Same all-or-nothing rule as Didit, for a sharper reason: a half-configured
    // payment provider means we hand a user an account number and then cannot
    // confirm what lands in it. Money arrives and nothing credits it.
    const klasha = [
      cfg.KLASHA_PUBLIC_KEY,
      cfg.KLASHA_ENCRYPTION_KEY,
      cfg.KLASHA_ACCOUNT_EMAIL,
      cfg.KLASHA_ACCOUNT_PASSWORD,
    ];
    if (klasha.some(Boolean) && !klasha.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['KLASHA_PUBLIC_KEY'],
        message:
          'KLASHA_PUBLIC_KEY, KLASHA_ENCRYPTION_KEY, KLASHA_ACCOUNT_EMAIL and KLASHA_ACCOUNT_PASSWORD must all be set together, or all left empty',
      });
    }
    if (cfg.KLASHA_ENCRYPTION_KEY && Buffer.byteLength(cfg.KLASHA_ENCRYPTION_KEY) !== 24) {
      ctx.addIssue({
        code: 'custom',
        path: ['KLASHA_ENCRYPTION_KEY'],
        message: `KLASHA_ENCRYPTION_KEY must be exactly 24 bytes for 3DES, got ${Buffer.byteLength(cfg.KLASHA_ENCRYPTION_KEY)}`,
      });
    }

    if (cfg.NODE_ENV === 'production' && cfg.KYC_ID_PEPPER.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['KYC_ID_PEPPER'],
        message:
          'KYC_ID_PEPPER must be at least 32 characters in production — ID hashes are worthless without it',
      });
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // Deliberately console, not the logger: the logger depends on this module.
  console.error(`Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
