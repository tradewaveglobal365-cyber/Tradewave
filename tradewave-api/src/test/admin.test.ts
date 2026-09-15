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
    .send({ firstName: 'Ada', lastName: 'Okafor', email, password: PASSWORD });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/verify-email')
    .set('Origin', ORIGIN)
    .send({ token });
  return { agent, userId: res.body.user.id as string };
}

async function promote(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
}

/**
 * Signs in AFTER promotion, so the access token carries role ADMIN.
 *
 * Matters because the role is baked in at issue time — the grant script says so
 * for the same reason.
 */
async function createAdmin(email: string) {
  const { userId } = await createUser(email);
  await promote(userId);
  const agent = request.agent(app);
  await agent
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email, password: PASSWORD })
    .expect(200);
  return { agent, userId };
}

describe('admin authorisation', () => {
  it('refuses an ordinary user', async () => {
    const { agent } = await createUser('user@example.com');
    const res = await agent.get('/api/v1/admin/deposits');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses a signed-out caller', async () => {
    const res = await request(app).get('/api/v1/admin/deposits');
    expect(res.status).toBe(401);
  });

  it('admits an admin', async () => {
    const { agent } = await createAdmin('admin@example.com');
    const res = await agent.get('/api/v1/admin/deposits').expect(200);
    expect(res.body.deposits).toEqual([]);
  });

  it('REVOKES IMMEDIATELY, without waiting for the token to expire', async () => {
    // The whole reason requireRole reads the database instead of req.auth.
    // This agent holds a valid, unexpired access token minted while they were an
    // admin. Demotion has to bite on the very next request — this is the window
    // in which someone is removed for cause.
    const { agent, userId } = await createAdmin('demote@example.com');
    await agent.get('/api/v1/admin/deposits').expect(200);

    await prisma.user.update({ where: { id: userId }, data: { role: 'USER' } });

    const after = await agent.get('/api/v1/admin/deposits');
    expect(after.status).toBe(403);
  });

  it('GRANTS IMMEDIATELY too, on a token issued before the promotion', async () => {
    // The other half of the same property, and the reason grant-admin.ts tells
    // people no sign-out is needed. This agent's access token was minted while
    // they were an ordinary USER and still says so.
    const { agent, userId } = await createUser('promote@example.com');
    await agent.get('/api/v1/admin/deposits').expect(403);

    await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });

    await agent.get('/api/v1/admin/deposits').expect(200);
  });

  it('gates the FX rate write but not the read', async () => {
    const { agent: user } = await createUser('reader@example.com');
    // Any signed-in user may read the rate — it is what funds their wallet.
    await user.get('/api/v1/fx/rate').expect(200);
    const denied = await user
      .put('/api/v1/fx/rate')
      .set('Origin', ORIGIN)
      .send({ minorPerUnit: '165000' });
    expect(denied.status).toBe(403);
    expect(await prisma.fxRate.count()).toBe(0);
  });
});

describe('setting the rate', () => {
  it('records a new row and returns it', async () => {
    const { agent, userId } = await createAdmin('rates@example.com');

    const res = await agent
      .put('/api/v1/fx/rate')
      .set('Origin', ORIGIN)
      .send({ minorPerUnit: '165000', midMinorPerUnit: '162000' })
      .expect(201);

    expect(res.body.minorPerUnit).toBe('165000');

    const row = await prisma.fxRate.findFirstOrThrow();
    expect(row.minorPerUnit).toBe(165_000n);
    expect(row.midMinorPerUnit).toBe(162_000n);
    // Who set it, so the spread on any deposit stays reconstructable later.
    expect(row.setByUserId).toBe(userId);
  });

  it('appends rather than overwrites, so history survives', async () => {
    const { agent } = await createAdmin('history@example.com');
    for (const rate of ['165000', '167500', '170000']) {
      await agent
        .put('/api/v1/fx/rate')
        .set('Origin', ORIGIN)
        .send({ minorPerUnit: rate })
        .expect(201);
    }
    expect(await prisma.fxRate.count()).toBe(3);

    const current = await agent.get('/api/v1/fx/rate').expect(200);
    expect(current.body.minorPerUnit).toBe('170000');
  });

  it('rejects a rate outside the plausible range rather than storing it', async () => {
    // A slipped decimal point is a hundredfold error in somebody's balance, and
    // the depositor would find it before we did.
    const { agent } = await createAdmin('bounds@example.com');
    for (const bad of ['1650', '99999999999']) {
      const res = await agent
        .put('/api/v1/fx/rate')
        .set('Origin', ORIGIN)
        .send({ minorPerUnit: bad });
      expect(res.status).toBe(400);
    }
    expect(await prisma.fxRate.count()).toBe(0);
  });

  it('rejects a non-integer rate at the schema', async () => {
    const { agent } = await createAdmin('schema@example.com');
    const res = await agent
      .put('/api/v1/fx/rate')
      .set('Origin', ORIGIN)
      .send({ minorPerUnit: '1650.50' });
    expect(res.status).toBe(422);
  });
});

describe('retrying a held deposit', () => {
  /** A payment that landed while no rate was published, so nothing was credited. */
  async function heldDeposit(email: string) {
    const { userId } = await createUser(email);
    await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: 'VERIFIED', kycVerifiedAt: new Date() },
    });

    vi.spyOn(paymentProvider, 'getPayment').mockResolvedValue({
      providerRef: 'tnx-held',
      amountMinor: 165_000_000n,
      currency: 'NGN',
      customerEmail: email,
      accountNumber: null,
      paidAt: new Date(),
    });
    await request(app)
      .post('/api/v1/wallet/deposits/webhook')
      .send({ data: { tnxRef: 'tnx-held' } })
      .expect(200);

    const deposit = await prisma.deposit.findUniqueOrThrow({
      where: { providerRef: 'tnx-held' },
    });
    expect(deposit.status).toBe('PENDING');
    return { userId, depositId: deposit.id };
  }

  it('shows the held deposit in the list', async () => {
    const { depositId } = await heldDeposit('held@example.com');
    const { agent } = await createAdmin('watcher@example.com');

    const res = await agent.get('/api/v1/admin/deposits').expect(200);
    const row = res.body.deposits.find((d: { id: string }) => d.id === depositId);
    expect(row.status).toBe('PENDING');
    expect(row.sourceAmountMinor).toBe('165000000');
    expect(row.amountCents).toBe('0');
    expect(row.rateMinorPerUnit).toBeNull();
    expect(row.user.email).toBe('held@example.com');
  });

  it('credits it once a rate exists', async () => {
    const { userId, depositId } = await heldDeposit('recover@example.com');
    const { agent } = await createAdmin('fixer@example.com');

    await agent
      .put('/api/v1/fx/rate')
      .set('Origin', ORIGIN)
      .send({ minorPerUnit: '165000' })
      .expect(201);

    const res = await agent.post(`/api/v1/admin/deposits/${depositId}/retry`).expect(200);
    expect(res.body.deposit.status).toBe('SUCCESS');
    expect(res.body.deposit.amountCents).toBe('100000');

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(wallet?.balanceCents).toBe(100_000n);
  });

  it('credits once even when retried repeatedly', async () => {
    const { userId, depositId } = await heldDeposit('twice@example.com');
    const { agent } = await createAdmin('impatient@example.com');
    await agent
      .put('/api/v1/fx/rate')
      .set('Origin', ORIGIN)
      .send({ minorPerUnit: '165000' })
      .expect(201);

    for (let i = 0; i < 3; i++) {
      await agent.post(`/api/v1/admin/deposits/${depositId}/retry`).expect(200);
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(wallet?.balanceCents).toBe(100_000n);
    expect(await prisma.ledgerEntry.count({ where: { type: 'DEPOSIT' } })).toBe(1);
  });

  it('404s for a deposit that does not exist', async () => {
    const { agent } = await createAdmin('missing@example.com');
    const res = await agent.post(
      '/api/v1/admin/deposits/00000000-0000-0000-0000-000000000000/retry',
    );
    expect(res.status).toBe(404);
  });
});
