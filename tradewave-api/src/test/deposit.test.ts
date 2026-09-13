import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { paymentProvider } from '../services/payments';
import { dollarsToCents } from '../lib/money';
import { migrateTestDatabase, resetDatabase } from './helpers';

const app = createApp();
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';

const verifyUrls: string[] = [];

beforeAll(() => {
  migrateTestDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.property.deleteMany();
  verifyUrls.length = 0;
  vi.restoreAllMocks();
  vi.spyOn(emailService, 'sendVerification').mockImplementation(async ({ verifyUrl }) => {
    verifyUrls.push(verifyUrl);
  });
});

/** Registers and confirms email. Identity is deliberately left unverified. */
async function createUser(email: string) {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ firstName: 'Ada', lastName: 'Okafor', email, password: PASSWORD });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/verify-email')
    .set('Origin', ORIGIN)
    .send({ token });
  return { agent, userId: res.body.user.id as string };
}

async function verifyIdentity(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { kycStatus: 'VERIFIED', kycVerifiedAt: new Date() },
  });
}

async function setRate(minorPerUnit = 165_000n) {
  await prisma.fxRate.create({
    data: { baseCurrency: 'USD', quoteCurrency: 'NGN', minorPerUnit },
  });
}

async function createProperty() {
  return prisma.property.create({
    data: {
      slug: `dep-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Test Tower',
      summary: 's',
      description: 'd',
      addressLine: 'a',
      area: 'Downtown Dubai',
      city: 'Dubai',
      images: [],
      totalValueCents: dollarsToCents('100000'),
      minInvestmentCents: dollarsToCents('250'),
      annualReturnBps: 800,
      termMonths: 24,
      status: 'OPEN',
    },
  });
}

/** Delivers a confirmed payment the way the provider would report it. */
async function payIn(email: string, amountMinor: bigint, providerRef: string) {
  vi.spyOn(paymentProvider, 'getPayment').mockResolvedValue({
    providerRef,
    amountMinor,
    currency: 'NGN',
    customerEmail: email,
    accountNumber: null,
    paidAt: new Date(),
  });
  await request(app)
    .post('/api/v1/wallet/deposits/webhook')
    .send({ data: { tnxRef: providerRef } })
    .expect(200);
}

describe('reaching the deposit account', () => {
  it('refuses an unverified user — we do not hold money for someone unidentified', async () => {
    const { agent } = await createUser('unverified@example.com');
    const res = await agent.get('/api/v1/wallet/deposit-account');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_REQUIRED');
  });

  it('still lets an unverified user see their own empty wallet', async () => {
    // The gate is on funding, not on the dashboard. A 403 on your own wallet
    // page reads as a broken app rather than an unfinished setup step.
    const { agent } = await createUser('wallet@example.com');
    const res = await agent.get('/api/v1/wallet');
    expect(res.status).toBe(200);
    expect(res.body.balanceCents).toBe('0');
  });

  it('returns account details once identity is verified', async () => {
    const { agent, userId } = await createUser('verified@example.com');
    await verifyIdentity(userId);
    await setRate();

    const res = await agent.get('/api/v1/wallet/deposit-account').expect(200);
    expect(res.body.accountNumber).toMatch(/^\d{10}$/);
    expect(res.body.bankName).toBeTruthy();
    expect(res.body.accountName).toContain('Ada');
    expect(res.body.currency).toBe('NGN');
    // The quote the UI shows before the user transfers anything.
    expect(res.body.rateMinorPerUnit).toBe('165000');
    expect(res.body.exampleKoboForHundredUsd).toBe('16500000');
  });

  it('issues the account once and reuses it', async () => {
    // The number is something a user writes down. Issuing a second one would
    // leave them transferring into an account nobody is watching.
    const { agent, userId } = await createUser('stable@example.com');
    await verifyIdentity(userId);

    const first = await agent.get('/api/v1/wallet/deposit-account').expect(200);
    const second = await agent.get('/api/v1/wallet/deposit-account').expect(200);

    expect(second.body.accountNumber).toBe(first.body.accountNumber);
    expect(await prisma.depositAccount.count({ where: { userId } })).toBe(1);
  });

  it('reports the rate as null rather than guessing when none is set', async () => {
    const { agent, userId } = await createUser('norate@example.com');
    await verifyIdentity(userId);
    const res = await agent.get('/api/v1/wallet/deposit-account').expect(200);
    expect(res.body.rateMinorPerUnit).toBeNull();
    expect(res.body.exampleKoboForHundredUsd).toBeNull();
  });
});

describe('funding a wallet', () => {
  it('credits the balance and writes a matching ledger entry', async () => {
    const email = 'fund@example.com';
    const { agent, userId } = await createUser(email);
    await verifyIdentity(userId);
    await setRate();
    await agent.get('/api/v1/wallet/deposit-account');

    await payIn(email, 165_000_000n, 'tnx-fund'); // ₦1,650,000.00 -> $1,000.00

    const res = await agent.get('/api/v1/wallet').expect(200);
    expect(res.body.balanceCents).toBe('100000');

    const entry = res.body.entries[0];
    expect(entry.type).toBe('DEPOSIT');
    expect(entry.amountCents).toBe('100000');
    // The snapshot has to equal the balance it produced, or the ledger cannot
    // be audited a row at a time — which is the only reason it is stored.
    expect(entry.balanceAfterCents).toBe('100000');
  });

  it('keeps the cached balance equal to the sum of its entries', async () => {
    const email = 'sum@example.com';
    const { agent, userId } = await createUser(email);
    await verifyIdentity(userId);
    await setRate();
    await agent.get('/api/v1/wallet/deposit-account');

    await payIn(email, 165_000_000n, 'tnx-a');
    await payIn(email, 82_500_000n, 'tnx-b');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    const entries = await prisma.ledgerEntry.aggregate({
      where: { walletId: wallet.id },
      _sum: { amountCents: true },
    });
    expect(wallet.balanceCents).toBe(entries._sum.amountCents);
    expect(wallet.balanceCents).toBe(150_000n); // $1,500.00
  });

  it('lets a funded, verified user invest — naira in, property stake out', async () => {
    // The headline. Everything else in this file is a precondition for it.
    const email = 'invest@example.com';
    const { agent, userId } = await createUser(email);
    await verifyIdentity(userId);
    await setRate();
    const property = await createProperty();

    await agent.get('/api/v1/wallet/deposit-account').expect(200);

    // Before any money arrives, investing is refused for want of funds.
    const broke = await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: dollarsToCents('250').toString() });
    expect(broke.status).toBe(422);
    expect(broke.body.error.code).toBe('INSUFFICIENT_FUNDS');

    await payIn(email, 165_000_000n, 'tnx-invest'); // $1,000.00

    // Same cookie, no re-login: the balance is read from the database, not from
    // a claim baked into the access token when it was issued.
    const invested = await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: dollarsToCents('250').toString() });

    expect(invested.status).toBe(201);
    expect(invested.body.balanceCents).toBe('75000'); // $1,000 - $250

    const holdings = await prisma.investment.findMany({ where: { userId } });
    expect(holdings).toHaveLength(1);
    expect(holdings[0]?.principalCents).toBe(25_000n);
  });

  it('credits a payment that arrives for a user who never opened their wallet', async () => {
    // Klasha identifies a dedicated account by the email it was created with, so
    // resolution must not depend on a DepositAccount row we happen to have read.
    const email = 'lazy@example.com';
    const { userId } = await createUser(email);
    await verifyIdentity(userId);
    await setRate();

    await payIn(email, 165_000_000n, 'tnx-lazy');

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(wallet?.balanceCents).toBe(100_000n);
  });
});
