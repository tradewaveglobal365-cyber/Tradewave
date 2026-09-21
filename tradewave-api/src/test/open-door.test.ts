import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { paymentProvider } from '../services/payments';
import { dollarsToCents } from '../lib/money';
import { migrateTestDatabase, resetDatabase } from './helpers';

/**
 * The whole journey, for somebody who never verifies their identity.
 *
 * Every step here was a 403 before identity verification stopped being a
 * condition of using the product. The individual gates have their own tests;
 * this one exists because the thing we actually promised was a JOURNEY without
 * a wall in it, and a suite of green unit tests can still add up to a product
 * that stops somebody on step four.
 *
 * The second test is the other half of the promise: the one thing that IS held
 * back is held back, and released the moment they verify.
 */

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

/** Signs up and confirms email. Identity is deliberately left alone. */
async function signUp(email: string, referralCode?: string) {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({
      firstName: 'Ada',
      lastName: 'Okafor',
      email,
      password: PASSWORD,
      // The shape a Nigerian investor actually types.
      phone: '0803 000 0000',
      ...(referralCode ? { referralCode } : {}),
    });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/verify-email')
    .set('Origin', ORIGIN)
    .send({ token });
  return { agent, userId: res.body.user.id as string, user: res.body.user };
}

async function openProperty() {
  return prisma.property.create({
    data: {
      slug: `od-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Marina Heights',
      summary: 's',
      description: 'd',
      addressLine: 'a',
      area: 'Dubai Marina',
      city: 'Dubai',
      images: [],
      totalValueCents: dollarsToCents('1000000'),
      minInvestmentCents: dollarsToCents('10'),
      annualReturnBps: 800,
      termMonths: 24,
      status: 'OPEN',
    },
  });
}

describe('an investor who never verifies', () => {
  it('can fund, invest, add a payout account and withdraw', async () => {
    const { agent, userId, user } = await signUp('open@example.com');
    expect(user.kycStatus).toBe('NOT_STARTED');
    // Stored in E.164 whatever spacing they used.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).phone).toBe(
      '+2348030000000',
    );

    // 1. A naira account to pay into.
    const account = await agent.get('/api/v1/wallet/deposit-account').expect(200);
    expect(account.body.accountNumber).toBeTruthy();

    // 2. Money arrives and is credited at the published rate.
    await prisma.fxRate.create({
      data: { minorPerUnit: 165_000n, effectiveAt: new Date() },
    });
    vi.spyOn(paymentProvider, 'getPayment').mockResolvedValue({
      providerRef: 'od_ref_1',
      amountMinor: 165_000_00n, // ₦165,000 at ₦1,650/$ = $100
      currency: 'NGN',
      customerEmail: 'open@example.com',
      accountNumber: null,
      paidAt: new Date(),
    });
    await request(app)
      .post('/api/v1/wallet/deposits/webhook')
      .send({ data: { tnxRef: 'od_ref_1' } })
      .expect(200);

    const funded = await agent.get('/api/v1/wallet').expect(200);
    expect(funded.body.balanceCents).toBe('10000');
    expect(funded.body.availableCents).toBe('10000');
    expect(funded.body.lockedCents).toBe('0');

    // 3. Invest it.
    const property = await openProperty();
    await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: '5000' })
      .expect(201);

    // 4. Say where money should go.
    const banks = await agent.get('/api/v1/wallet/banks').expect(200);
    await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send({
        bankCode: banks.body.banks[0].code,
        accountNumber: '0690000032',
        accountName: 'Ada Okafor',
      })
      .expect(200);

    // Saving it freezes the name — the control that replaced the identity gate.
    const renamed = await agent
      .patch('/api/v1/auth/me')
      .set('Origin', ORIGIN)
      .send({ firstName: 'Musa', lastName: 'Ibrahim' });
    expect(renamed.status).toBe(422);

    // 5. Take the rest out. The 24h destination hold is the only thing left in
    //    the way, and it is about the DESTINATION rather than about them.
    await prisma.payoutAccount.update({
      where: { userId },
      data: { destinationChangedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });
    const withdrawal = await agent
      .post('/api/v1/wallet/withdrawals')
      .set('Origin', ORIGIN)
      .send({ amountCents: '5000' });
    expect(withdrawal.status).toBe(201);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(wallet.balanceCents).toBe(0n);
  });

  it('earns a referral bonus, cannot spend it, and gets it on verifying', async () => {
    const referrer = await signUp('referrer@example.com');
    const code = (
      await prisma.user.findUniqueOrThrow({ where: { id: referrer.userId } })
    ).referralCode;

    // Somebody they invited invests $2,000, so 1% = $20 is owed.
    const invitee = await signUp('invitee@example.com', code);
    await prisma.wallet.create({
      data: { userId: invitee.userId, balanceCents: dollarsToCents('5000') },
    });
    const property = await openProperty();
    await invitee.agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: dollarsToCents('2000').toString() })
      .expect(201);

    // Paid, visible, and not spendable.
    const held = await referrer.agent.get('/api/v1/wallet').expect(200);
    expect(held.body.balanceCents).toBe('2000');
    expect(held.body.lockedCents).toBe('2000');
    expect(held.body.availableCents).toBe('0');

    const summary = await referrer.agent.get('/api/v1/referrals/me').expect(200);
    expect(summary.body.earnedCents).toBe('2000');
    expect(summary.body.lockedCents).toBe('2000');

    const refused = await referrer.agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: '2000' });
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toMatch(/referral/i);

    // Verify — the stub driver decides immediately outside production.
    await referrer.agent
      .post('/api/v1/kyc/submit')
      .set('Origin', ORIGIN)
      .send({ consent: true })
      .expect(201);

    const released = await referrer.agent.get('/api/v1/wallet').expect(200);
    expect(released.body.balanceCents).toBe('2000');
    expect(released.body.lockedCents).toBe('0');
    expect(released.body.availableCents).toBe('2000');

    // The release moved no money, so it wrote no ledger row: one bonus entry,
    // exactly as before verifying.
    const entries = await prisma.ledgerEntry.count({
      where: { wallet: { userId: referrer.userId } },
    });
    expect(entries).toBe(1);

    // And now it spends.
    await referrer.agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: '2000' })
      .expect(201);
  });
});
