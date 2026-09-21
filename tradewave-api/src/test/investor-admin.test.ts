import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
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

async function createUser(email: string, firstName = 'Ada', lastName = 'Okafor') {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ firstName, lastName, email, password: PASSWORD, phone: '08030000000' });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/verify-email')
    .set('Origin', ORIGIN)
    .send({ token });
  return { agent, userId: res.body.user.id as string };
}

async function createAdmin(email: string) {
  const { userId } = await createUser(email, 'Staff', 'Member');
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
  const agent = request.agent(app);
  await agent
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email, password: PASSWORD })
    .expect(200);
  return { agent, userId };
}

describe('the investor list', () => {
  it('is refused to an ordinary user', async () => {
    const { agent } = await createUser('nosy@example.com');
    const res = await agent.get('/api/v1/admin/investors');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('shows every user with their balance and what they have invested', async () => {
    const { userId } = await createUser('investor@example.com', 'Joshua', 'Okoghie');
    const { agent } = await createAdmin('staff@example.com');

    // A balance, written the way the ledger requires: never without an entry.
    const wallet = await prisma.wallet.create({
      data: { userId, balanceCents: 250_00n },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: 'DEPOSIT',
        amountCents: 250_00n,
        balanceAfterCents: 250_00n,
        reference: 'test_dep_1',
        description: 'Wallet funding',
      },
    });

    const res = await agent.get('/api/v1/admin/investors').expect(200);
    const row = res.body.investors.find((i: { id: string }) => i.id === userId);

    expect(row.email).toBe('investor@example.com');
    expect(row.balanceCents).toBe('25000');
    expect(row.investedCents).toBe('0');
    expect(row.kycStatus).toBe('NOT_STARTED');
    expect(row.hasPayoutAccount).toBe(false);
    expect(res.body.total).toBe(2);
  });

  it('NEVER returns a password hash', async () => {
    await createUser('secret@example.com');
    const { agent } = await createAdmin('staff@example.com');

    const res = await agent.get('/api/v1/admin/investors').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    for (const row of res.body.investors) {
      expect(row).not.toHaveProperty('passwordHash');
    }
  });

  it('finds someone by a first and last name held in separate columns', async () => {
    await createUser('j@example.com', 'Joshua', 'Okoghie');
    await createUser('other@example.com', 'Adebayo', 'Samuel');
    const { agent } = await createAdmin('staff@example.com');

    const res = await agent.get('/api/v1/admin/investors?q=joshua okoghie').expect(200);
    expect(res.body.investors).toHaveLength(1);
    expect(res.body.investors[0].email).toBe('j@example.com');
  });

  it('finds someone by email fragment, case-insensitively', async () => {
    await createUser('Findme@Example.com');
    const { agent } = await createAdmin('staff@example.com');

    const res = await agent.get('/api/v1/admin/investors?q=FINDME').expect(200);
    expect(res.body.investors).toHaveLength(1);
  });

  it('pages rather than returning everyone', async () => {
    const { agent } = await createAdmin('staff@example.com');
    const res = await agent.get('/api/v1/admin/investors?page=2').expect(200);

    // One admin exists, so page two is past the end — and says so honestly
    // rather than silently wrapping back to the first page.
    expect(res.body.investors).toEqual([]);
    expect(res.body.total).toBe(1);
    expect(res.body.page).toBe(2);
  });

  it('falls back to page one for a nonsense page number', async () => {
    const { agent } = await createAdmin('staff@example.com');
    const res = await agent.get('/api/v1/admin/investors?page=banana').expect(200);
    expect(res.body.page).toBe(1);
    expect(res.body.investors).toHaveLength(1);
  });
});

describe('one investor', () => {
  it('carries the ledger, and masks the payout account number', async () => {
    const { userId } = await createUser('detail@example.com', 'Joshua', 'Okoghie');
    const { agent } = await createAdmin('staff@example.com');

    const wallet = await prisma.wallet.create({
      data: { userId, balanceCents: 100_00n },
    });
    await prisma.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: 'DEPOSIT',
        amountCents: 100_00n,
        balanceAfterCents: 100_00n,
        reference: 'test_dep_2',
        description: 'Wallet funding',
      },
    });
    await prisma.payoutAccount.create({
      data: {
        userId,
        bankCode: '044',
        bankName: 'Access Bank',
        accountNumber: '0690000032',
        accountName: 'JOSHUA OKOGHIE',
        nameResolved: true,
      },
    });

    const res = await agent.get(`/api/v1/admin/investors/${userId}`).expect(200);
    const investor = res.body.investor;

    expect(investor.balanceCents).toBe('10000');
    expect(investor.entries).toHaveLength(1);
    expect(investor.entries[0].description).toBe('Wallet funding');

    // The full number never reaches the browser, for staff either. Reading it
    // off a screen is not part of any workflow this page supports.
    expect(investor.payoutAccount.accountNumberMasked).toBe('••••0032');
    expect(JSON.stringify(res.body)).not.toContain('0690000032');
    expect(investor.payoutAccount.nameResolved).toBe(true);
  });

  it('NEVER returns the KYC document hash', async () => {
    const { userId } = await createUser('kyc@example.com');
    const { agent } = await createAdmin('staff@example.com');

    await prisma.kycVerification.create({
      data: {
        userId,
        provider: 'didit',
        status: 'VERIFIED',
        documentLast4: '0550',
        // A keyed HMAC used to spot one document across accounts. It is an
        // internal dedupe key, and a screen is where those go to be copied
        // into a spreadsheet.
        documentHash: 'a-very-secret-hmac-value',
      },
    });

    const res = await agent.get(`/api/v1/admin/investors/${userId}`).expect(200);
    expect(res.body.investor.kyc.documentLast4).toBe('0550');
    expect(JSON.stringify(res.body)).not.toContain('a-very-secret-hmac-value');
    expect(res.body.investor.kyc).not.toHaveProperty('documentHash');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('404s for someone who does not exist', async () => {
    const { agent } = await createAdmin('staff@example.com');
    const res = await agent.get(
      '/api/v1/admin/investors/00000000-0000-0000-0000-000000000000',
    );
    expect(res.status).toBe(404);
  });
});

describe('the identity review queue', () => {
  it('lists only what the provider escalated, oldest first', async () => {
    const { userId: waiting } = await createUser('review@example.com', 'Moses', 'Ateghie');
    const { userId: abandoned } = await createUser('halfway@example.com');
    const { agent } = await createAdmin('staff@example.com');

    await prisma.kycVerification.create({
      data: {
        userId: waiting,
        provider: 'didit',
        status: 'PENDING',
        providerStatus: 'In Review',
        livenessScore: 100,
        faceMatchScore: 87.11,
        submittedAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
      },
    });
    // Opened the flow and walked away. Also PENDING, needs nothing from staff,
    // and must not bury the row that does.
    await prisma.kycVerification.create({
      data: {
        userId: abandoned,
        provider: 'didit',
        status: 'PENDING',
        providerStatus: 'In Progress',
      },
    });

    const res = await agent.get('/api/v1/admin/identity/reviews').expect(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.reviews[0].user.email).toBe('review@example.com');
    expect(res.body.reviews[0].waitingHours).toBeGreaterThanOrEqual(71);
    expect(res.body.reviews[0].faceMatchScore).toBeCloseTo(87.11);
  });

  it('is refused to an ordinary user', async () => {
    const { agent } = await createUser('nosy2@example.com');
    expect((await agent.get('/api/v1/admin/identity/reviews')).status).toBe(403);
  });
});
