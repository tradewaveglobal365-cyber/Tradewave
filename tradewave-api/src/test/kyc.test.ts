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
const NIN = '12345678901';

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

describe('submitting identity verification', () => {
  it('records an attempt and moves the user off NOT_STARTED', async () => {
    const { agent, userId } = await createUser('kyc@example.com');

    const res = await agent
      .post('/api/v1/kyc/submit')
      .set('Origin', ORIGIN)
      .send({ documentType: 'NIN', documentNumber: NIN });

    expect(res.status).toBe(201);
    // The stub driver approves outside production, so the flow is demoable.
    expect(res.body.status).toBe('VERIFIED');
    expect(res.body.documentLast4).toBe('8901');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.kycStatus).toBe('VERIFIED');
    expect(user.kycVerifiedAt).not.toBeNull();
  });

  it('never persists the raw document number', async () => {
    const { agent, userId } = await createUser('raw@example.com');
    await agent
      .post('/api/v1/kyc/submit')
      .set('Origin', ORIGIN)
      .send({ documentType: 'NIN', documentNumber: NIN });

    const row = await prisma.kycVerification.findFirstOrThrow({ where: { userId } });
    expect(JSON.stringify(row)).not.toContain(NIN);
    // Only the display tail survives, and the hash is keyed rather than a bare digest.
    expect(row.documentLast4).toBe('8901');
    expect(row.documentHash).toHaveLength(64);
    expect(row.documentHash).not.toBe(NIN);
  });

  it('rejects a NIN that is not exactly 11 digits, with a field error', async () => {
    const { agent } = await createUser('short@example.com');

    for (const bad of ['1234567890', '123456789012', 'abcdefghijk']) {
      const res = await agent
        .post('/api/v1/kyc/submit')
        .set('Origin', ORIGIN)
        .send({ documentType: 'NIN', documentNumber: bad });
      expect(res.status).toBe(422);
      expect(res.body.error.fields).toHaveProperty('documentNumber');
    }
  });

  it('refuses a document already verified on another account', async () => {
    const first = await createUser('owner@example.com');
    await first.agent
      .post('/api/v1/kyc/submit')
      .set('Origin', ORIGIN)
      .send({ documentType: 'NIN', documentNumber: NIN });

    const second = await createUser('thief@example.com');
    const res = await second.agent
      .post('/api/v1/kyc/submit')
      .set('Origin', ORIGIN)
      .send({ documentType: 'NIN', documentNumber: NIN });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOCUMENT_ALREADY_VERIFIED');
    // Must not leak whose account holds it.
    expect(JSON.stringify(res.body)).not.toContain('owner@example.com');
  });

  it('does not spend a second check once already verified', async () => {
    const { agent, userId } = await createUser('once@example.com');
    const spy = vi.spyOn(kycProvider, 'startVerification');

    await agent.post('/api/v1/kyc/submit').set('Origin', ORIGIN)
      .send({ documentType: 'NIN', documentNumber: NIN });
    await agent.post('/api/v1/kyc/submit').set('Origin', ORIGIN)
      .send({ documentType: 'NIN', documentNumber: NIN });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(await prisma.kycVerification.count({ where: { userId } })).toBe(1);
  });

  it('caps attempts in the service, where the express limiter cannot reach', async () => {
    const { agent, userId } = await createUser('grind@example.com');
    // Force the provider to reject so attempts accumulate instead of terminating.
    vi.spyOn(kycProvider, 'startVerification').mockResolvedValue({
      providerRef: null,
      widgetUrl: null,
      status: 'REJECTED',
      rejectionReason: 'No match',
    });

    for (let i = 0; i < 3; i++) {
      await agent.post('/api/v1/kyc/submit').set('Origin', ORIGIN)
        .send({ documentType: 'NIN', documentNumber: `1234567890${i}` });
    }
    const res = await agent.post('/api/v1/kyc/submit').set('Origin', ORIGIN)
      .send({ documentType: 'NIN', documentNumber: '99999999999' });

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
      .send({ documentType: 'NIN', documentNumber: NIN });

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
