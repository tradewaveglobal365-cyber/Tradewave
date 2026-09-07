import argon2 from 'argon2';

/**
 * OWASP Password Storage Cheat Sheet, argon2id baseline:
 *   19 MiB memory, 2 iterations, 1 degree of parallelism.
 * Memory cost is the parameter that actually hurts GPU attackers — do not lower
 * it to speed up tests; use a smaller value only under NODE_ENV=test if needed.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed hash in the database should read as "wrong password",
    // never as a 500 that tells an attacker something unusual happened.
    return false;
  }
}

/**
 * A dummy hash to verify against when the email doesn't exist.
 *
 * Without this, a login for a non-existent user returns in ~1ms while a real
 * user's wrong password takes ~50ms, and that timing difference alone is a
 * working account-enumeration oracle.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0YkKQMR7wPmYFcRe9pFcTLXjMqUB6TvUdG5cbYPBv7k';

export async function burnTimingBudget(plain: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, plain);
}
