import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { dollarsToCents } from '../lib/money';
import { migrateTestDatabase, resetDatabase } from './helpers';

const app = createApp();
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';

const verifyUrls: string[] = [];

beforeAll(() => {
  migrateTestDatabase();
  vi.spyOn(emailService, 'sendVerification').mockImplementation(async ({ verifyUrl }) => {
    verifyUrls.push(verifyUrl);
  });
  vi.spyOn(emailService, 'sendDuplicateSignupNotice').mockResolvedValue();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.property.deleteMany();
  verifyUrls.length = 0;
});

/**
 * Registers, verifies email AND identity, and funds a wallet. Returns an
 * authenticated agent.
 *
 * Identity is set directly rather than through the KYC endpoint: these tests are
 * about investment mechanics, and the gate itself is covered in kyc.test.ts.
 */
async function createFundedUser(email: string, balance: string) {
  await request(app).post('/api/v1/auth/register').set('Origin', ORIGIN).send({
    firstName: 'Test',
    lastName: 'Investor',
    email,
    password: PASSWORD,
  });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/verify-email').set('Origin', ORIGIN).send({ token });
  const userId = res.body.user.id as string;

  await prisma.user.update({
    where: { id: userId },
    data: { kycStatus: 'VERIFIED', kycVerifiedAt: new Date() },
  });

  const wallet = await prisma.wallet.upsert({
    where: { userId },
    update: { balanceCents: dollarsToCents(balance) },
    create: { userId, balanceCents: dollarsToCents(balance) },
  });

  // Write the matching ledger entry. Setting a balance without one would leave
  // the books unbalanced before a single test ran, making assertLedgerIntegrity
  // meaningless — which is exactly what it caught the first time round.
  await prisma.ledgerEntry.create({
    data: {
      walletId: wallet.id,
      type: 'DEPOSIT',
      amountCents: dollarsToCents(balance),
      balanceAfterCents: dollarsToCents(balance),
      reference: `open-${userId}`,
      description: 'Opening balance',
    },
  });

  return { agent, userId };
}

async function createProperty(overrides: Partial<{ total: string; min: string; bps: number }> = {}) {
  return prisma.property.create({
    data: {
      slug: `test-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Test Tower',
      summary: 's',
      description: 'd',
      addressLine: 'a',
      area: 'Downtown Dubai',
      city: 'Dubai',
      images: [],
      totalValueCents: dollarsToCents(overrides.total ?? '100000'),
      minInvestmentCents: dollarsToCents(overrides.min ?? '1000'),
      annualReturnBps: overrides.bps ?? 800,
      termMonths: 24,
      status: 'OPEN',
    },
  });
}

/**
 * The invariant that catches everything else: a wallet's cached balance must
 * always equal the sum of its ledger entries. If these ever disagree, some
 * write escaped the transaction.
 */
async function assertLedgerIntegrity(userId: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { userId },
    include: { entries: true },
  });
  const sum = wallet.entries.reduce((acc, e) => acc + e.amountCents, 0n);
  expect(sum).toBe(wallet.balanceCents);
}

describe('creating an investment', () => {
  it('debits the wallet, records the holding and advances property funding', async () => {
    const { agent, userId } = await createFundedUser('buy@example.com', '50000');
    const property = await createProperty({ total: '100000', min: '1000' });

    const res = await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: dollarsToCents('10000').toString() });

    expect(res.status).toBe(201);
    expect(res.body.balanceCents).toBe(dollarsToCents('40000').toString());

    const investment = await prisma.investment.findFirstOrThrow({ where: { userId } });
    expect(investment.principalCents).toBe(dollarsToCents('10000'));

    const after = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(after.fundedCents).toBe(dollarsToCents('10000'));

    await assertLedgerIntegrity(userId);
  });

  it('snapshots the rate and term, so later property edits do not change agreed terms', async () => {
    const { agent, userId } = await createFundedUser('snap@example.com', '20000');
    const property = await createProperty({ bps: 800 });

    await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: dollarsToCents('5000').toString() });

    await prisma.property.update({
      where: { id: property.id },
      data: { annualReturnBps: 2500, termMonths: 60 },
    });

    const investment = await prisma.investment.findFirstOrThrow({ where: { userId } });
    expect(investment.annualReturnBps).toBe(800);
    expect(investment.termMonths).toBe(24);
  });

  it('rejects an amount below the property minimum', async () => {
    const { agent } = await createFundedUser('min@example.com', '50000');
    const property = await createProperty({ min: '5000' });

    const res = await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: dollarsToCents('1000').toString() });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BELOW_MINIMUM');
  });

  it('rejects an investment larger than the wallet balance', async () => {
    const { agent, userId } = await createFundedUser('poor@example.com', '1000');
    const property = await createProperty({ min: '100' });

    const res = await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: dollarsToCents('5000').toString() });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await prisma.investment.count({ where: { userId } })).toBe(0);
  });

  it('refuses a property that is not open', async () => {
    const { agent } = await createFundedUser('closed@example.com', '50000');
    const property = await createProperty();
    await prisma.property.update({ where: { id: property.id }, data: { status: 'CLOSED' } });

    const res = await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: dollarsToCents('5000').toString() });

    expect(res.status).toBe(409);
  });

  it('closes the property once it is fully subscribed', async () => {
    const { agent } = await createFundedUser('full@example.com', '100000');
    const property = await createProperty({ total: '10000', min: '1000' });

    const res = await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: dollarsToCents('10000').toString() });

    expect(res.status).toBe(201);
    const after = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(after.status).toBe('FUNDED');
  });

  it('requires a verified account', async () => {
    await request(app).post('/api/v1/auth/register').set('Origin', ORIGIN).send({
      firstName: 'Un',
      lastName: 'Verified',
      email: 'unverified@example.com',
      password: PASSWORD,
    });
    const property = await createProperty();

    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'unverified@example.com', password: PASSWORD });

    const cookie = (login.headers['set-cookie'] as unknown as string[]) ?? [];
    const res = await request(app)
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ propertyId: property.id, amountCents: dollarsToCents('5000').toString() });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

/**
 * These exercise REAL concurrency — the requests genuinely overlap. Verified by
 * temporarily replacing the conditional update with a naive read-then-write and
 * adding a 150ms delay between the read and the write: all five requests then
 * succeed and the wallet goes negative.
 *
 * Without that artificial delay the race window is sub-millisecond, so a broken
 * implementation would often pass by luck. Treat these as a safety net, not a
 * proof — the guarantee comes from the conditions living in the WHERE clause.
 * The invariant assertions below are the part that always holds.
 */
describe('concurrency', () => {
  it('never lets a wallet go negative under simultaneous investments', async () => {
    const { agent, userId } = await createFundedUser('race1@example.com', '10000');
    const property = await createProperty({ total: '1000000', min: '1000' });

    // Twelve simultaneous requests, each for the ENTIRE balance.
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        agent
          .post('/api/v1/investments')
          .set('Origin', ORIGIN)
          .send({ propertyId: property.id, amountCents: dollarsToCents('10000').toString() }),
      ),
    );

    const created = results.filter((r) => r.status === 201);
    expect(created).toHaveLength(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    // The invariant that holds no matter how the race resolves.
    expect(wallet.balanceCents >= 0n).toBe(true);
    expect(wallet.balanceCents).toBe(0n);
    expect(await prisma.investment.count({ where: { userId } })).toBe(1);
    await assertLedgerIntegrity(userId);
  });

  it('never oversubscribes a property under simultaneous investments', async () => {
    const property = await createProperty({ total: '10000', min: '1000' });

    // Eight different users each trying to take the whole remaining allocation.
    // Created SEQUENTIALLY: createFundedUser reads the most recent verification
    // URL from a shared array, so parallel setup makes users collect each
    // other's tokens. The parallelism that matters is the invest calls below.
    const users: Awaited<ReturnType<typeof createFundedUser>>[] = [];
    for (let i = 0; i < 8; i += 1) {
      users.push(await createFundedUser(`race2-${i}@example.com`, '50000'));
    }

    const results = await Promise.all(
      users.map(({ agent }) =>
        agent
          .post('/api/v1/investments')
          .set('Origin', ORIGIN)
          .send({ propertyId: property.id, amountCents: dollarsToCents('10000').toString() }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);

    const after = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    // The invariant: a property can never be funded beyond its own value.
    expect(after.fundedCents <= after.totalValueCents).toBe(true);
    expect(after.fundedCents).toBe(after.totalValueCents);

    // And every participant's books must still balance.
    for (const { userId } of users) await assertLedgerIntegrity(userId);
  });

  it('does not charge a user whose allocation was taken', async () => {
    const property = await createProperty({ total: '10000', min: '1000' });
    const winner = await createFundedUser('winner@example.com', '50000');
    const loser = await createFundedUser('loser@example.com', '50000');

    await winner.agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: dollarsToCents('10000').toString() });

    const res = await loser.agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: dollarsToCents('10000').toString() });

    expect(res.status).toBe(409);

    // The debit must have rolled back — no charge for a stake never received.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: loser.userId } });
    expect(wallet.balanceCents).toBe(dollarsToCents('50000'));
    expect(await prisma.investment.count({ where: { userId: loser.userId } })).toBe(0);
  });
});
