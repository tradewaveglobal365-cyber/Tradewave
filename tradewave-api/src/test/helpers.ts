import { execSync } from 'node:child_process';
import { prisma } from '../lib/prisma';

let migrated = false;

/** Applies migrations once per run, then truncates between tests. */
export function migrateTestDatabase(): void {
  if (migrated) return;
  execSync('npx prisma migrate deploy', {
    stdio: 'ignore',
    env: { ...process.env, DIRECT_URL: process.env.DATABASE_URL },
  });
  migrated = true;
}

export async function resetDatabase(): Promise<void> {
  // Order matters only without CASCADE; RESTART IDENTITY keeps runs comparable.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "KycVerification", "LoginAttempt", "VerificationToken", "Session", "User" RESTART IDENTITY CASCADE',
  );
}

/** Pulls the most recent raw token for a user straight from the DB. */
export async function latestRawTokenHashFor(
  userId: string,
  type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
) {
  return prisma.verificationToken.findFirst({
    where: { userId, type },
    orderBy: { createdAt: 'desc' },
  });
}

/** Reads a Set-Cookie value out of a supertest response. */
export function readCookie(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  for (const entry of list) {
    const match = new RegExp(`^${name}=([^;]+)`).exec(entry);
    if (match?.[1]) return match[1];
  }
  return undefined;
}
