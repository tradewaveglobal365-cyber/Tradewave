import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { paymentProvider } from '../services/payments';
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
  verifyUrls.length = 0;
  vi.restoreAllMocks();
  vi.spyOn(emailService, 'sendVerification').mockImplementation(async ({ verifyUrl }) => {
    verifyUrls.push(verifyUrl);
  });
});

async function createUser(email: string) {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ firstName: 'Joshua', lastName: 'Okoghie', email, password: PASSWORD });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/verify-email')
    .set('Origin', ORIGIN)
    .send({ token });
  return { agent, userId: res.body.user.id as string };
}

async function verified(email: string) {
  const { agent, userId } = await createUser(email);
  await prisma.user.update({
    where: { id: userId },
    data: { kycStatus: 'VERIFIED', kycVerifiedAt: new Date() },
  });
  return { agent, userId };
}

const account = (over: Record<string, string> = {}) => ({
  bankCode: '044',
  accountNumber: '0690000032',
  accountName: 'OKOGHIE JOSHUA',
  ...over,
});

describe('reaching the payout account', () => {
  it('refuses an unverified user — there is no verified name to check against', async () => {
    const { agent } = await createUser('unverified@example.com');
    const res = await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send(account());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_REQUIRED');
    expect(await prisma.payoutAccount.count()).toBe(0);
  });

  it('returns null before one is added', async () => {
    const { agent } = await verified('none@example.com');
    const res = await agent.get('/api/v1/wallet/payout-account').expect(200);
    expect(res.body.account).toBeNull();
  });

  it('lists banks for the form', async () => {
    const { agent } = await verified('banks@example.com');
    const res = await agent.get('/api/v1/wallet/banks').expect(200);
    expect(res.body.banks.length).toBeGreaterThan(0);
    expect(res.body.banks[0]).toHaveProperty('code');
    expect(res.body.banks[0]).toHaveProperty('name');
  });
});

describe('the name check', () => {
  it('saves an account in the investor’s own name, reordered', async () => {
    const { agent, userId } = await verified('match@example.com');

    const res = await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send(account({ accountName: 'OKOGHIE JOSHUA EMMANUEL' }))
      .expect(200);

    expect(res.body.account.bankName).toBe('Access Bank');
    // Never send a full account number back to a browser.
    expect(res.body.account.accountNumberMasked).toBe('••••0032');
    expect(res.body.account).not.toHaveProperty('accountNumber');
    // Nobody independent confirmed it, and the row says so.
    expect(res.body.account.nameResolved).toBe(false);

    const row = await prisma.payoutAccount.findUniqueOrThrow({ where: { userId } });
    expect(row.accountNumber).toBe('0690000032');
  });

  it('REFUSES somebody else’s account and writes nothing', async () => {
    // The control this whole feature exists for.
    const { agent } = await verified('mule@example.com');

    const res = await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send(account({ accountName: 'ADEBAYO SAMUEL' }));

    expect(res.status).toBe(422);
    expect(res.body.error.fields.accountName).toMatch(/does not match your verified identity/i);
    expect(await prisma.payoutAccount.count()).toBe(0);
  });

  it('prefers the BANK’s answer over what the user typed', async () => {
    // Once the provider can resolve a name, the user's typing stops mattering —
    // which is the point. Here they type their own name over someone else's
    // account and it is still refused.
    const { agent } = await verified('resolved@example.com');
    vi.spyOn(paymentProvider, 'resolveAccountName').mockResolvedValue('ADEBAYO SAMUEL');

    const res = await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send(account({ accountName: 'Joshua Okoghie' }));

    expect(res.status).toBe(422);
    expect(res.body.error.fields.accountName).toMatch(/belongs to ADEBAYO SAMUEL/i);
    expect(await prisma.payoutAccount.count()).toBe(0);
  });

  it('stores the bank’s name, not the typed one, when it resolves', async () => {
    const { agent, userId } = await verified('stored@example.com');
    vi.spyOn(paymentProvider, 'resolveAccountName').mockResolvedValue('OKOGHIE JOSHUA EMMANUEL');

    await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send(account({ accountName: 'joshua okoghie' }))
      .expect(200);

    const row = await prisma.payoutAccount.findUniqueOrThrow({ where: { userId } });
    expect(row.accountName).toBe('OKOGHIE JOSHUA EMMANUEL');
    expect(row.nameResolved).toBe(true);
  });

  it('falls back to the typed name when resolution FAILS rather than refusing', async () => {
    // A provider outage must not read to the user as "your name is wrong".
    const { agent } = await verified('outage@example.com');
    vi.spyOn(paymentProvider, 'resolveAccountName').mockRejectedValue(new Error('provider down'));

    await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send(account())
      .expect(200);
  });
});

describe('replacing it', () => {
  it('overwrites rather than accumulating', async () => {
    const { agent, userId } = await verified('replace@example.com');

    await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send(account())
      .expect(200);

    await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send(account({ bankCode: '058', accountNumber: '0123456789' }))
      .expect(200);

    expect(await prisma.payoutAccount.count({ where: { userId } })).toBe(1);
    const row = await prisma.payoutAccount.findUniqueOrThrow({ where: { userId } });
    expect(row.bankName).toBe('Guaranty Trust Bank');
    expect(row.accountNumber).toBe('0123456789');
  });
});

describe('input it should not accept', () => {
  it('rejects an account number that is not 10 digits', async () => {
    const { agent } = await verified('digits@example.com');
    for (const bad of ['123', '06900000321', 'abcdefghij', '069 000 0032']) {
      const res = await agent
        .put('/api/v1/wallet/payout-account')
        .set('Origin', ORIGIN)
        .send(account({ accountNumber: bad }));
      expect(res.status).toBe(422);
    }
    expect(await prisma.payoutAccount.count()).toBe(0);
  });

  it('rejects a bank code that is not in the provider’s list', async () => {
    // A code we invent is a payout that fails long after the user has gone.
    const { agent } = await verified('bank@example.com');
    const res = await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send(account({ bankCode: '000' }));
    expect(res.status).toBe(422);
    expect(res.body.error.fields.bankCode).toBeTruthy();
  });
});
