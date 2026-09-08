import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { kycProvider } from '../services/kyc';
import { dirhamToFils } from '../lib/money';
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
  vi.restoreAllMocks();
  vi.spyOn(emailService, 'sendVerification').mockImplementation(async ({ verifyUrl }) => {
    verifyUrls.push(verifyUrl);
  });
});

/** Registers and verifies email only — identity deliberately left unstarted. */
async function createUser(email: string) {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ firstName: 'Test', lastName: 'Investor', email, password: PASSWORD });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/verify-email').set('Origin', ORIGIN).send({ token });
  return { agent, userId: res.body.user.id as string };
}

async function createProperty() {
  return prisma.property.create({
    data: {
      slug: `kyc-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Test Tower',
      summary: 's',
      description: 'd',
      addressLine: 'a',
      area: 'Downtown Dubai',
      city: 'Dubai',
      images: [],
      totalValueFils: dirhamToFils('100000'),
      minInvestmentFils: dirhamToFils('1000'),
      annualReturnBps: 800,
      termMonths: 24,
      status: 'OPEN',
    },
  });
}

describe('starting identity verification', () => {
  it('records an attempt and moves the user off NOT_STARTED', async () => {
    const { agent, userId } = await createUser('kyc@example.com');

    const res = await agent
      .post('/api/v1/kyc/submit')
      .set('Origin', ORIGIN)
      .send({ consent: true });

    expect(res.status).toBe(201);
    // The stub driver has no hosted step and decides inline outside production,
    // so the flow is demoable without a provider.
    expect(res.body.status).toBe('VERIFIED');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.kycStatus).toBe('VERIFIED');
    expect(user.kycVerifiedAt).not.toBeNull();
  });

  it('never persists the raw document number', async () => {
    const { agent, userId } = await createUser('raw@example.com');
    await agent.post('/api/v1/kyc/submit').set('Origin', ORIGIN).send({ consent: true });

    const row = await prisma.kycVerification.findFirstOrThrow({ where: { userId } });
    expect(row.documentHash).toHaveLength(64);
    expect(row.documentLast4).toHaveLength(4);
    // Whatever the provider read, only its keyed digest and last four survive.
    expect(row.documentHash).not.toContain(row.documentLast4);
  });

  it('requires consent, with a field error the form can map back', async () => {
    const { agent } = await createUser('noconsent@example.com');

    const res = await agent
      .post('/api/v1/kyc/submit')
      .set('Origin', ORIGIN)
      .send({ consent: false });

    expect(res.status).toBe(422);
    expect(res.body.error.fields).toHaveProperty('consent');
  });

  it('does not start a second session once already verified', async () => {
    const { agent, userId } = await createUser('once@example.com');
    const spy = vi.spyOn(kycProvider, 'startVerification');

    await agent.post('/api/v1/kyc/submit').set('Origin', ORIGIN).send({ consent: true });
    await agent.post('/api/v1/kyc/submit').set('Origin', ORIGIN).send({ consent: true });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(await prisma.kycVerification.count({ where: { userId } })).toBe(1);
  });

  it('caps attempts in the service, where the express limiter cannot reach', async () => {
    const { agent, userId } = await createUser('grind@example.com');
    // Force rejections so attempts accumulate instead of terminating on success.
    vi.spyOn(kycProvider, 'startVerification').mockResolvedValue({
      providerRef: null,
      redirectUrl: null,
      status: 'REJECTED',
      rejectionReason: 'Document unreadable',
    });

    for (let i = 0; i < 3; i++) {
      await agent.post('/api/v1/kyc/submit').set('Origin', ORIGIN).send({ consent: true });
    }
    const res = await agent
      .post('/api/v1/kyc/submit')
      .set('Origin', ORIGIN)
      .send({ consent: true });

    expect(res.status).toBe(429);
    expect(await prisma.kycVerification.count({ where: { userId } })).toBe(3);
  });
});

describe('the investment gate', () => {
  it('blocks investing until identity is verified, and lifts without a new token', async () => {
    const { agent, userId } = await createUser('gate@example.com');
    await prisma.wallet.create({
      data: { userId, balanceFils: dirhamToFils('50000') },
    });
    const property = await createProperty();
    const body = {
      propertyId: property.id,
      amountFils: dirhamToFils('10000').toString(),
    };

    const blocked = await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send(body);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('KYC_REQUIRED');

    await agent
      .post('/api/v1/kyc/submit')
      .set('Origin', ORIGIN)
      .send({ consent: true });

    // Same agent, same 15-minute access token. This is the whole reason the gate
    // reads the database instead of the JWT: had kycStatus lived in the token,
    // this request would still be a 403 and the user would be stuck staring at a
    // "Verified" badge.
    const allowed = await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send(body);
    expect(allowed.status).toBe(201);
  });

  it('reports KYC_PENDING separately, so the UI can say "under review"', async () => {
    const { agent, userId } = await createUser('pending@example.com');
    await prisma.user.update({ where: { id: userId }, data: { kycStatus: 'PENDING' } });
    const property = await createProperty();

    const res = await agent.post('/api/v1/investments').set('Origin', ORIGIN).send({
      propertyId: property.id,
      amountFils: dirhamToFils('1000').toString(),
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_PENDING');
  });

  it('leaves the portfolio and wallet readable while unverified', async () => {
    const { agent } = await createUser('read@example.com');

    expect((await agent.get('/api/v1/portfolio')).status).toBe(200);
    expect((await agent.get('/api/v1/wallet')).status).toBe(200);
  });
});

describe('reading identity status', () => {
  it('starts at NOT_STARTED with retries available', async () => {
    const { agent } = await createUser('fresh@example.com');

    const res = await agent.get('/api/v1/kyc/me');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('NOT_STARTED');
    expect(res.body.canRetry).toBe(true);
    expect(res.body.documentLast4).toBeNull();
  });

  it('requires a session', async () => {
    expect((await request(app).get('/api/v1/kyc/me')).status).toBe(401);
  });
});
