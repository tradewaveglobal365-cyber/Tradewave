import { isTest } from '../../config/env';
import { logger } from '../../lib/logger';
import { claim, release, INSTANCE_ID } from './lock';
import { JOBS, type Job } from './jobs';

/**
 * An in-process scheduler: one tick a minute, jobs claimed with a database lock.
 *
 * ── Why in the API process and not a cron service ─────────────────────────
 * Because there is nothing else to deploy, nothing else to monitor, and no
 * second set of environment variables to keep in step with this one. The cost
 * is that the work only happens while the API is up — which is the same
 * condition every other part of the product already depends on.
 *
 * ── Why a tick a minute, when nothing runs that often ─────────────────────
 * The tick is cheap: one indexed query per job against a four-row table, and
 * the claim returns false immediately when a job is not due. Frequent ticking
 * is what makes a job recover quickly after a deploy or a crash, instead of
 * waiting out a long interval that happened to start at the wrong moment.
 */

const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runJob(job: Job): Promise<void> {
  if (!(await claim(job.name, job.everyMs, job.leaseMs))) return;

  const startedAt = Date.now();
  try {
    await job.run();
    await release(job.name);
    logger.debug({ job: job.name, ms: Date.now() - startedAt }, 'Scheduled job finished');
  } catch (err) {
    // Recorded on the row AND logged. A job that fails silently on a timer is
    // indistinguishable from one that is not scheduled at all.
    logger.error({ err, job: job.name }, 'Scheduled job failed');
    await release(job.name, err).catch((releaseErr: unknown) => {
      // The lease is what saves us here: an unreleased lock expires on its own
      // rather than parking the job forever.
      logger.error({ err: releaseErr, job: job.name }, 'Could not release a job lock');
    });
  }
}

/**
 * One pass over every job.
 *
 * Sequential on purpose. These are background chores on the same database the
 * API is serving requests from, and running four at once buys nothing but
 * contention at the exact moment a user is waiting on a page.
 */
export async function tick(): Promise<void> {
  // A tick that overruns must not stack on the next one. With a minute between
  // ticks and a sweep that can take longer, this is a real case, not a
  // theoretical one.
  if (running) {
    logger.warn('Scheduler tick skipped — the previous one is still running');
    return;
  }
  running = true;
  try {
    for (const job of JOBS) await runJob(job);
  } finally {
    running = false;
  }
}

/**
 * Starts ticking.
 *
 * Skipped under test, for the same reason the sweeps' own throttles are: a
 * timer firing in the middle of a suite makes failures depend on how long the
 * previous test took, which is the least debuggable kind of flake there is.
 * scheduler.test.ts calls tick() and the jobs directly instead.
 */
export function startScheduler(): void {
  if (isTest || timer) return;

  // unref so a pending tick can never be the reason the process will not exit
  // on SIGTERM. Render restarts containers routinely and a scheduler is not a
  // reason to hold one open.
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();

  logger.info({ instance: INSTANCE_ID, jobs: JOBS.map((j) => j.name) }, 'Scheduler started');
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  logger.info('Scheduler stopped');
}
