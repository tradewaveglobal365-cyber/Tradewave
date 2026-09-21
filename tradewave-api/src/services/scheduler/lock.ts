import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';

/**
 * The thing that stops two API instances running the same job at once.
 *
 * Render can run more than one instance, and every job here either sends email
 * or moves money. "Two instances both emailed the August statement" is not a
 * theoretical problem — it is the default behaviour of a naive setInterval on a
 * service that scales past one box.
 *
 * The claim is a single conditional updateMany, which is the same trick the
 * wallet, investment and withdrawal paths already use: Postgres decides, not a
 * read-then-write in application code that two processes can interleave. The
 * loser sees count === 0 and does nothing.
 *
 * A lease rather than a flag, so a crashed run releases itself when lockedUntil
 * passes instead of wedging the job until somebody notices.
 */

/** Identifies this process in the lock row, for telling stuck from busy. */
export const INSTANCE_ID = randomUUID();

/**
 * Tries to take the job's slot.
 *
 * Returns false when another instance holds it, OR when it simply is not due
 * yet — both are "not my turn", and folding the due check into the same query
 * is what makes it atomic. Checking due-ness separately would reintroduce
 * exactly the race the lock exists to remove.
 */
export async function claim(name: string, everyMs: number, leaseMs: number): Promise<boolean> {
  const now = new Date();

  // Create the row on first sight, and only then.
  //
  // ON CONFLICT DO NOTHING rather than an upsert, because an upsert is a SELECT
  // followed by an INSERT and this is precisely the moment two instances race:
  // they boot together, tick together, and both find no row for a job that has
  // never run. The loser's INSERT then violates the primary key and THROWS,
  // which took down the claim itself — the one function whose whole job is to
  // make concurrent instances safe. Postgres arbitrates instead, and a row that
  // already exists is not an error here, it is the postcondition.
  await prisma.$executeRaw`
    INSERT INTO "ScheduledJob" ("name") VALUES (${name})
    ON CONFLICT ("name") DO NOTHING
  `;

  const { count } = await prisma.scheduledJob.updateMany({
    where: {
      name,
      // Free, or the previous holder's lease has expired.
      //
      // The explicit null arm is not optional: in SQL `lockedUntil < now` is
      // NULL — and therefore not true — for a NULL column, so a `lt` alone
      // would never match a job that has never run.
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      AND: [
        {
          OR: [{ lastRunAt: null }, { lastRunAt: { lt: new Date(now.getTime() - everyMs) } }],
        },
      ],
    },
    data: {
      lockedUntil: new Date(now.getTime() + leaseMs),
      lockedBy: INSTANCE_ID,
    },
  });

  return count === 1;
}

/**
 * Hands the slot back, recording how it went.
 *
 * lastRunAt moves whether the run succeeded or failed. A job that throws every
 * time must not be retried on every tick — that turns one broken job into a
 * hot loop against the database and, for the email jobs, against Resend.
 */
export async function release(name: string, error?: unknown): Promise<void> {
  await prisma.scheduledJob.update({
    where: { name },
    data: {
      lockedUntil: null,
      lockedBy: null,
      lastRunAt: new Date(),
      runCount: { increment: 1 },
      lastError: error ? String(error instanceof Error ? error.message : error).slice(0, 500) : null,
    },
  });
}
