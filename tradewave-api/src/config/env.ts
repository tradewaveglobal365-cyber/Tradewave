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

  WEB_ORIGIN: z.string().url(),
  // Empty in development; ".tradewave.com" in production so the cookie is
  // shared between tradewave.com and api.tradewave.com.
  COOKIE_DOMAIN: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

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
