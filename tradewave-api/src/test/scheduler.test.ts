import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { claim, release, INSTANCE_ID } from '../services/scheduler/lock';
import { JOBS } from '../services/scheduler/jobs';
import { tick } from '../services/scheduler';
import { migrateTestDatabase, resetDatabase } from './helpers';
import { dollarsToCents } from '../lib/money';

const MINUTE = 60_000;

beforeAll(() => {
  migrateTestDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.property.deleteMany();
  vi.restoreAllMocks();
});

// ── The lock ────────────────────────────────────────────────────────────────

describe('the job lock', () => {
  it('lets exactly one of two concurrent claims win', async () => {
    const results = await Promise.all([
      claim('demo', 0, 5 * MINUTE),
      claim('demo', 0, 5 * MINUTE),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('refuses a second claim while the first still holds the lease', async () => {
    expect(await claim('demo', 0, 5 * MINUTE)).toBe(true);
    expect(await claim('demo', 0, 5 * MINUTE)).toBe(false);
  });

  it('records which instance holds it', async () => {
    await claim('demo', 0, 5 * MINUTE);
    const row = await prisma.scheduledJob.findUniqueOrThrow({ where: { name: 'demo' } });
    expect(row.lockedBy).toBe(INSTANCE_ID);
  });

  it('lets a crashed run be reclaimed once its lease expires', async () => {
    await claim('demo', 0, 5 * MINUTE);

    // The holder dies without releasing. Nothing clears the row.
    await prisma.scheduledJob.update({
      where: { name: 'demo' },
      data: { lockedUntil: new Date(Date.now() - MINUTE), lockedBy: 'a-dead-instance' },
    });

    expect(await claim('demo', 0, 5 * MINUTE)).toBe(true);
  });

  it('will not run again inside its interval', async () => {
    expect(await claim('demo', HOUR, 5 * MINUTE)).toBe(true);
    await release('demo');

    // Released, so not locked — but not due either.
    expect(await claim('demo', HOUR, 5 * MINUTE)).toBe(false);
  });

  it('runs again once the interval has passed', async () => {
    await claim('demo', HOUR, 5 * MINUTE);
    await release('demo');

    await prisma.scheduledJob.update({
      where: { name: 'demo' },
      data: { lastRunAt: new Date(Date.now() - 2 * HOUR) },
    });

    expect(await claim('demo', HOUR, 5 * MINUTE)).toBe(true);
  });

  it('records a failure on the row rather than only in the log', async () => {
    await claim('demo', 0, 5 * MINUTE);
    await release('demo', new Error('provider unreachable'));

    const row = await prisma.scheduledJob.findUniqueOrThrow({ where: { name: 'demo' } });
    expect(row.lastError).toBe('provider unreachable');
    expect(row.lockedUntil).toBeNull();
    expect(row.runCount).toBe(1);
  });
});

const HOUR = 60 * MINUTE;

// ── Fixtures ────────────────────────────────────────────────────────────────

let seq = 0;

async function makeInvestor(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.user.create({
    data: {
      email: `investor${seq}@test.invalid`,
      passwordHash: 'x',
      firstName: 'Ada',
      lastName: 'Ibe',
      referralCode: `REF${seq}${Date.now() % 100000}`,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      ...overrides,
    },
  });
}

async function makeMaturingInvestment(userId: string, daysOut: number) {
  const property = await prisma.property.create({
    data: {
      slug: `marina-${seq}-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Marina Tower',
      summary: 's',
      description: 'd',
      addressLine: 'a',
      area: 'Dubai Marina',
      city: 'Dubai',
      images: [],
      totalValueCents: dollarsToCents('1000000'),
      minInvestmentCents: dollarsToCents('1000'),
      annualReturnBps: 900,
      termMonths: 24,
      status: 'OPEN',
    },
  });

  const investedAt = new Date(Date.now() - 300 * 24 * HOUR);
  return prisma.investment.create({
    data: {
      userId,
      propertyId: property.id,
      principalCents: dollarsToCents('5000'),
      annualReturnBps: 900,
      termMonths: 24,
      status: 'ACTIVE',
      investedAt,
      maturesAt: new Date(Date.now() + daysOut * 24 * HOUR),
    },
  });
}

// ── Maturity notices ────────────────────────────────────────────────────────

describe('the maturity notice job', () => {
  const job = JOBS.find((j) => j.name === 'maturity-notices')!;

  it('tells an investor a week before maturity, exactly once', async () => {
    const send = vi.spyOn(emailService, 'sendMaturityApproaching').mockResolvedValue();
    const user = await makeInvestor();
    const investment = await makeMaturingInvestment(user.id, 5);

    await job.run();
    expect(send).toHaveBeenCalledTimes(1);

    // A second pass finds the stamp and does nothing — the lock is not what
    // protects this, the marker is.
    await job.run();
    expect(send).toHaveBeenCalledTimes(1);

    const after = await prisma.investment.findUniqueOrThrow({ where: { id: investment.id } });
    expect(after.maturityNoticeSentAt).not.toBeNull();
  });

  it('leaves an investment maturing further out alone', async () => {
    const send = vi.spyOn(emailService, 'sendMaturityApproaching').mockResolvedValue();
    const user = await makeInvestor();
    await makeMaturingInvestment(user.id, 30);

    await job.run();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not email a suspended investor, but still stamps the row', async () => {
    const send = vi.spyOn(emailService, 'sendMaturityApproaching').mockResolvedValue();
    const user = await makeInvestor({ status: 'SUSPENDED' });
    const investment = await makeMaturingInvestment(user.id, 3);

    await job.run();

    expect(send).not.toHaveBeenCalled();
    const after = await prisma.investment.findUniqueOrThrow({ where: { id: investment.id } });
    expect(after.maturityNoticeSentAt).not.toBeNull();
  });

  it('quotes the projected payout, not the principal', async () => {
    const send = vi.spyOn(emailService, 'sendMaturityApproaching').mockResolvedValue();
    const user = await makeInvestor();
    await makeMaturingInvestment(user.id, 2);

    await job.run();

    const arg = send.mock.calls[0]![0];
    expect(arg.payout).not.toBe('$5,000.00');
    expect(arg.propertyTitle).toBe('Marina Tower');
  });
});

// ── Abandoned identity checks ───────────────────────────────────────────────

describe('the abandoned identity job', () => {
  const job = JOBS.find((j) => j.name === 'abandoned-identity')!;

  async function makeAttempt(userId: string, overrides: Record<string, unknown> = {}) {
    return prisma.kycVerification.create({
      data: {
        userId,
        provider: 'stub',
        status: 'PENDING',
        redirectUrl: 'https://provider.test/resume/abc',
        submittedAt: new Date(Date.now() - 48 * HOUR),
        ...overrides,
      },
    });
  }

  it('nudges a session left open, once, with the resume link', async () => {
    const send = vi.spyOn(emailService, 'sendKycAbandoned').mockResolvedValue();
    const user = await makeInvestor({ kycStatus: 'PENDING' });
    await makeAttempt(user.id);

    await job.run();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].url).toBe('https://provider.test/resume/abc');

    await job.run();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('leaves a session started an hour ago alone', async () => {
    const send = vi.spyOn(emailService, 'sendKycAbandoned').mockResolvedValue();
    const user = await makeInvestor({ kycStatus: 'PENDING' });
    await makeAttempt(user.id, { submittedAt: new Date(Date.now() - HOUR) });

    await job.run();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not chase a session whose resume link has expired', async () => {
    const send = vi.spyOn(emailService, 'sendKycAbandoned').mockResolvedValue();
    const user = await makeInvestor({ kycStatus: 'PENDING' });
    await makeAttempt(user.id, { expiresAt: new Date(Date.now() - HOUR) });

    await job.run();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not chase somebody whose check a human is already reviewing', async () => {
    const send = vi.spyOn(emailService, 'sendKycAbandoned').mockResolvedValue();
    const user = await makeInvestor({ kycStatus: 'PENDING' });
    await makeAttempt(user.id, { providerStatus: 'In Review' });

    await job.run();
    expect(send).not.toHaveBeenCalled();
  });
});

// ── Monthly statements ──────────────────────────────────────────────────────

describe('the monthly statement job', () => {
  const job = JOBS.find((j) => j.name === 'monthly-statements')!;

  /** An entry inside the month that has just ended. */
  function lastMonth(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  }

  async function makeWalletWithActivity(userId: string) {
    const wallet = await prisma.wallet.create({ data: { userId, balanceCents: dollarsToCents('1000') } });
    await prisma.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: 'DEPOSIT',
        amountCents: dollarsToCents('1000'),
        balanceAfterCents: dollarsToCents('1000'),
        reference: `dep_${userId}`,
        description: 'Wallet funding',
        createdAt: lastMonth(),
      },
    });
    return wallet;
  }

  it('sends last month once, then never again for that period', async () => {
    const send = vi.spyOn(emailService, 'sendMonthlyStatement').mockResolvedValue();
    const user = await makeInvestor();
    await makeWalletWithActivity(user.id);

    await job.run();
    expect(send).toHaveBeenCalledTimes(1);

    await job.run();
    expect(send).toHaveBeenCalledTimes(1);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lastStatementPeriod).toMatch(/^\d{4}-\d{2}$/);
  });

  it('sends nothing for a month in which nothing moved', async () => {
    const send = vi.spyOn(emailService, 'sendMonthlyStatement').mockResolvedValue();
    const user = await makeInvestor();
    await prisma.wallet.create({ data: { userId: user.id, balanceCents: 0n } });

    await job.run();
    expect(send).not.toHaveBeenCalled();
  });

  it('skips an unverified address', async () => {
    const send = vi.spyOn(emailService, 'sendMonthlyStatement').mockResolvedValue();
    const user = await makeInvestor({ emailVerifiedAt: null, status: 'PENDING_VERIFICATION' });
    await makeWalletWithActivity(user.id);

    await job.run();
    expect(send).not.toHaveBeenCalled();
  });
});

// ── The tick ────────────────────────────────────────────────────────────────

describe('the tick', () => {
  it('runs every job and releases every lock', async () => {
    await tick();

    const rows = await prisma.scheduledJob.findMany();
    expect(rows.map((r) => r.name).sort()).toEqual(JOBS.map((j) => j.name).sort());
    for (const row of rows) {
      expect(row.lockedUntil).toBeNull();
      expect(row.lastRunAt).not.toBeNull();
    }
  });

  it('does not run a job twice across two ticks in the same interval', async () => {
    const send = vi.spyOn(emailService, 'sendMaturityApproaching').mockResolvedValue();
    const user = await makeInvestor();
    await makeMaturingInvestment(user.id, 4);

    await tick();
    await tick();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('survives a job that throws, and records why', async () => {
    vi.spyOn(emailService, 'sendMaturityApproaching').mockResolvedValue();
    const user = await makeInvestor();
    await makeMaturingInvestment(user.id, 4);

    // Not `...Once`: the sweeps job runs first and calls this too, and it
    // swallows its own failures by design — so a single rejection would be
    // consumed there and never reach the job under test.
    vi.spyOn(prisma.investment, 'findMany').mockRejectedValue(new Error('database on fire'));

    await expect(tick()).resolves.toBeUndefined();

    const row = await prisma.scheduledJob.findUnique({ where: { name: 'maturity-notices' } });
    expect(row?.lastError).toBe('database on fire');
    expect(row?.lockedUntil).toBeNull();
  });
});
