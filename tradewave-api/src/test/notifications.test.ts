import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { paymentProvider } from '../services/payments';
import { applyDecision } from '../modules/kyc/kyc.service';
import { applyPayment } from '../modules/wallet/deposit.service';
import { createInvestment } from '../modules/investment/investment.service';
import { dollarsToCents } from '../lib/money';
import { migrateTestDatabase, resetDatabase } from './helpers';

const app = createApp();
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';

const verifyUrls: string[] = [];

/** Spies on every notification, so a test can assert what a user was told. */
const sent = {
  kyc: vi.fn(),
  deposit: vi.fn(),
  investment: vi.fn(),
  payout: vi.fn(),
};

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
  for (const fn of Object.values(sent)) fn.mockReset();

  vi.spyOn(emailService, 'sendVerification').mockImplementation(async ({ verifyUrl }) => {
    verifyUrls.push(verifyUrl);
  });
  vi.spyOn(emailService, 'sendKycDecided').mockImplementation(sent.kyc);
  vi.spyOn(emailService, 'sendDepositCredited').mockImplementation(sent.deposit);
  vi.spyOn(emailService, 'sendInvestmentConfirmed').mockImplementation(sent.investment);
  vi.spyOn(emailService, 'sendPayoutAccountChanged').mockImplementation(sent.payout);
});

async function createUser(email: string, firstName = 'Moses', lastName = 'Solomon') {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ firstName, lastName, email, password: PASSWORD });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/verify-email')
    .set('Origin', ORIGIN)
    .send({ token });
  return { agent, userId: res.body.user.id as string };
}

async function pendingAttempt(userId: string) {
  const row = await prisma.kycVerification.create({
    data: { userId, provider: 'didit', status: 'PENDING' },
  });
  await prisma.user.update({ where: { id: userId }, data: { kycStatus: 'PENDING' } });
  return row.id;
}

describe('the identity decision email', () => {
  it('tells the investor when they are approved', async () => {
    const { userId } = await createUser('ok@example.com');
    const reference = await pendingAttempt(userId);

    await applyDecision({
      reference,
      providerRef: 'didit-1',
      status: 'VERIFIED',
      providerStatus: 'Approved',
      firstName: 'Moses',
      lastName: 'Solomon',
    });

    expect(sent.kyc).toHaveBeenCalledTimes(1);
    expect(sent.kyc.mock.calls[0][0]).toMatchObject({
      to: 'ok@example.com',
      approved: true,
      adoptedName: undefined,
    });
  });

  it('tells them why when it is refused', async () => {
    const { userId } = await createUser('no@example.com');
    const reference = await pendingAttempt(userId);

    await applyDecision({
      reference,
      providerRef: 'didit-2',
      status: 'REJECTED',
      providerStatus: 'Declined',
      rejectionReason: 'The document was not fully in frame.',
    });

    expect(sent.kyc.mock.calls[0][0]).toMatchObject({
      approved: false,
      reason: 'The document was not fully in frame.',
    });
  });

  it('says nothing while the decision is still pending', async () => {
    const { userId } = await createUser('wait@example.com');
    const reference = await pendingAttempt(userId);

    await applyDecision({
      reference,
      providerRef: 'didit-3',
      status: 'PENDING',
      providerStatus: 'In Review',
    });

    expect(sent.kyc).not.toHaveBeenCalled();
  });
});

describe('adopting the verified name', () => {
  /**
   * The Moses case. He registered as "Moses Solomon" and verified a licence
   * reading "Moses Ateghie". Leaving the typed name in place meant his own bank
   * account could never match his own profile, and the name lock meant he could
   * not correct either — permanently unable to be paid.
   */
  it('takes the name from the document, not from signup', async () => {
    const { userId } = await createUser('moses@example.com', 'Moses', 'Solomon');
    const reference = await pendingAttempt(userId);

    await applyDecision({
      reference,
      providerRef: 'didit-4',
      status: 'VERIFIED',
      providerStatus: 'Approved',
      firstName: 'Moses',
      lastName: 'Ateghie',
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.firstName).toBe('Moses');
    expect(user.lastName).toBe('Ateghie');

    // And he is told, because his profile now reads differently than he left it.
    expect(sent.kyc.mock.calls[0][0]).toMatchObject({
      approved: true,
      adoptedName: 'Moses Ateghie',
    });
  });

  it('leaves the name alone when the provider returns none', async () => {
    const { userId } = await createUser('noname@example.com', 'Ada', 'Okafor');
    const reference = await pendingAttempt(userId);

    await applyDecision({
      reference,
      providerRef: 'didit-5',
      status: 'VERIFIED',
      providerStatus: 'Approved',
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.firstName).toBe('Ada');
    expect(user.lastName).toBe('Okafor');
  });

  it('never renames on a refusal', async () => {
    const { userId } = await createUser('keep@example.com', 'Ada', 'Okafor');
    const reference = await pendingAttempt(userId);

    await applyDecision({
      reference,
      providerRef: 'didit-6',
      status: 'REJECTED',
      providerStatus: 'Declined',
      firstName: 'Someone',
      lastName: 'Else',
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.lastName).toBe('Okafor');
  });
});

describe('the deposit email', () => {
  async function fundedUser(email: string) {
    const { userId } = await createUser(email);
    await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: 'VERIFIED', kycVerifiedAt: new Date() },
    });
    await prisma.fxRate.create({
      data: { baseCurrency: 'USD', quoteCurrency: 'NGN', minorPerUnit: 165_000n },
    });
    return userId;
  }

  it('confirms the money, the conversion and the new balance', async () => {
    const userId = await fundedUser('cash@example.com');
    await prisma.depositAccount.create({
      data: {
        userId,
        provider: 'stub',
        accountNumber: '1234567890',
        accountName: 'Tradewave / Moses Solomon',
        bankName: 'Stub Bank',
      },
    });

    await applyPayment({
      providerRef: 'tnx-1',
      amountMinor: 16_500_000n, // ₦165,000 → $100
      currency: 'NGN',
      customerEmail: 'cash@example.com',
      accountNumber: '1234567890',
      paidAt: new Date(),
    });

    expect(sent.deposit).toHaveBeenCalledTimes(1);
    const email = sent.deposit.mock.calls[0][0];
    expect(email.to).toBe('cash@example.com');
    expect(email.amountCredited).toContain('100');
    expect(email.newBalance).toContain('100');
  });

  it('does NOT tell them twice when the webhook is replayed', async () => {
    const userId = await fundedUser('once@example.com');
    await prisma.depositAccount.create({
      data: {
        userId,
        provider: 'stub',
        accountNumber: '2234567890',
        accountName: 'Tradewave / Moses Solomon',
        bankName: 'Stub Bank',
      },
    });

    const payment = {
      providerRef: 'tnx-2',
      amountMinor: 16_500_000n,
      currency: 'NGN',
      customerEmail: 'once@example.com',
      accountNumber: '2234567890',
      paidAt: new Date(),
    };

    await applyPayment(payment);
    await applyPayment(payment);

    // The ledger's unique reference stops the second credit; the email has to
    // sit behind that same gate or a retrying provider mails them repeatedly.
    expect(sent.deposit).toHaveBeenCalledTimes(1);
  });
});

describe('the payout account security notice', () => {
  it('tells the account owner every time the destination changes', async () => {
    const { agent, userId } = await createUser('payout@example.com', 'Joshua', 'Okoghie');
    await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: 'VERIFIED', kycVerifiedAt: new Date() },
    });
    vi.spyOn(paymentProvider, 'resolveAccountName').mockResolvedValue(null);

    await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send({ bankCode: '044', accountNumber: '0690000032', accountName: 'Joshua Okoghie' })
      .expect(200);

    expect(sent.payout).toHaveBeenCalledTimes(1);
    const email = sent.payout.mock.calls[0][0];
    expect(email.to).toBe('payout@example.com');
    // Masked here too: an email sits in an inbox for years.
    expect(email.accountNumberMasked).toBe('••••0032');
    expect(JSON.stringify(email)).not.toContain('0690000032');
  });

  it('sends nothing when the account is refused', async () => {
    const { agent, userId } = await createUser('refused@example.com', 'Joshua', 'Okoghie');
    await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: 'VERIFIED', kycVerifiedAt: new Date() },
    });
    vi.spyOn(paymentProvider, 'resolveAccountName').mockResolvedValue('ADEBAYO SAMUEL');

    await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send({ bankCode: '044', accountNumber: '0690000032', accountName: 'Joshua Okoghie' })
      .expect(422);

    expect(sent.payout).not.toHaveBeenCalled();
  });
});

describe('the investment receipt', () => {
  it('carries the terms fixed at the moment of investing', async () => {
    const { userId } = await createUser('invest@example.com');
    const property = await prisma.property.create({
      data: {
        slug: 'palm-tower',
        title: 'Palm Tower',
        summary: 's',
        description: 'd',
        addressLine: 'a',
        area: 'Palm Jumeirah',
        city: 'Dubai',
        images: [],
        totalValueCents: dollarsToCents('100000'),
        minInvestmentCents: dollarsToCents('1000'),
        annualReturnBps: 850,
        termMonths: 24,
        status: 'OPEN',
      },
    });

    const wallet = await prisma.wallet.create({
      data: { userId, balanceCents: dollarsToCents('5000') },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: 'DEPOSIT',
        amountCents: dollarsToCents('5000'),
        balanceAfterCents: dollarsToCents('5000'),
        reference: 'seed_1',
        description: 'Wallet funding',
      },
    });

    await createInvestment(userId, property.id, dollarsToCents('2500'));

    expect(sent.investment).toHaveBeenCalledTimes(1);
    const email = sent.investment.mock.calls[0][0];
    expect(email.to).toBe('invest@example.com');
    expect(email.propertyTitle).toBe('Palm Tower');
    expect(email.amount).toContain('2,500');
    expect(email.annualReturn).toBe('8.50%');
    expect(email.termMonths).toBe(24);
  });

  it('sends nothing when the investment is refused', async () => {
    const { userId } = await createUser('broke@example.com');
    const property = await prisma.property.create({
      data: {
        slug: 'marina-view',
        title: 'Marina View',
        summary: 's',
        description: 'd',
        addressLine: 'a',
        area: 'Dubai Marina',
        city: 'Dubai',
        images: [],
        totalValueCents: dollarsToCents('100000'),
        minInvestmentCents: dollarsToCents('1000'),
        annualReturnBps: 800,
        termMonths: 12,
        status: 'OPEN',
      },
    });

    // No balance at all, so the debit fails and the transaction rolls back.
    await expect(
      createInvestment(userId, property.id, dollarsToCents('2500')),
    ).rejects.toThrow();
    expect(sent.investment).not.toHaveBeenCalled();
  });
});
