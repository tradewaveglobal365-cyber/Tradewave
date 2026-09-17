import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { dollarsToCents } from '../lib/money';
import { migrateTestDatabase, resetDatabase } from './helpers';

/**
 * Records investors can keep.
 *
 * The assertions that matter are that the bytes really are a PDF, and that one
 * investor cannot fetch another's certificate — a document route that leaks is
 * worse than one that does not exist, because it hands over a name, an amount
 * and a property in one file.
 */

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
  vi.spyOn(emailService, 'sendInvestmentConfirmed').mockResolvedValue();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.property.deleteMany();
  verifyUrls.length = 0;
});

async function investor(email: string, balance = '50000') {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ firstName: 'Joshua', lastName: 'Okoghie', email, password: PASSWORD });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/verify-email').set('Origin', ORIGIN).send({ token });
  const userId = res.body.user.id as string;

  await prisma.user.update({
    where: { id: userId },
    data: { kycStatus: 'VERIFIED', kycVerifiedAt: new Date() },
  });

  const wallet = await prisma.wallet.create({
    data: { userId, balanceCents: dollarsToCents(balance) },
  });
  await prisma.ledgerEntry.create({
    data: {
      walletId: wallet.id,
      type: 'DEPOSIT',
      amountCents: dollarsToCents(balance),
      balanceAfterCents: dollarsToCents(balance),
      reference: `open-${userId}`,
      description: 'Wallet funding',
    },
  });

  return { agent, userId };
}

async function property() {
  return prisma.property.create({
    data: {
      slug: `doc-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Marina Tower Residence',
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
}

async function invest(agent: ReturnType<typeof request.agent>, propertyId: string, amount: string) {
  const res = await agent
    .post('/api/v1/investments')
    .set('Origin', ORIGIN)
    .send({ propertyId, amountCents: String(dollarsToCents(amount)) })
    .expect(201);
  return res.body.investment.id as string;
}

/** The first bytes of any PDF. Proves we sent a file, not an error page. */
const isPdf = (body: Buffer) => body.subarray(0, 5).toString('latin1') === '%PDF-';

describe('the document list', () => {
  it('is empty before anything is held', async () => {
    const { agent } = await investor('nodocs@example.com');
    const res = await agent.get('/api/v1/documents').expect(200);
    expect(res.body.documents).toEqual([]);
  });

  it('offers a certificate for each holding', async () => {
    const { agent } = await investor('hasdocs@example.com');
    const p = await property();
    await invest(agent, p.id, '5000');

    const res = await agent.get('/api/v1/documents').expect(200);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0]).toMatchObject({
      kind: 'CERTIFICATE',
      title: 'Marina Tower Residence',
    });
  });

  it('needs a session', async () => {
    await request(app).get('/api/v1/documents').expect(401);
  });
});

describe('the certificate', () => {
  it('comes back as a real PDF', async () => {
    const { agent } = await investor('cert@example.com');
    const p = await property();
    const id = await invest(agent, p.id, '5000');

    const res = await agent
      .get(`/api/v1/documents/certificate/${id}`)
      .buffer()
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers['content-type']).toBe('application/pdf');
    expect(isPdf(res.body)).toBe(true);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(1000);
  });

  /** The one that would leak a name, an amount and a property in one file. */
  it('cannot be fetched by another investor', async () => {
    const mine = await investor('mine@example.com');
    const theirs = await investor('theirs@example.com');
    const p = await property();
    const id = await invest(mine.agent, p.id, '5000');

    // 404 rather than 403 — a 403 confirms the id is real.
    await theirs.agent.get(`/api/v1/documents/certificate/${id}`).expect(404);
  });

  it('404s for an investment that does not exist', async () => {
    const { agent } = await investor('missing@example.com');
    await agent
      .get('/api/v1/documents/certificate/11111111-1111-4111-8111-111111111111')
      .expect(404);
  });

  it('is never cached by a shared cache', async () => {
    const { agent } = await investor('nocache@example.com');
    const p = await property();
    const id = await invest(agent, p.id, '5000');

    const res = await agent.get(`/api/v1/documents/certificate/${id}`).expect(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['cache-control']).toContain('private');
  });
});

describe('the statement', () => {
  const range = () => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  };

  it('comes back as a real PDF covering the period', async () => {
    const { agent } = await investor('stmt@example.com');
    const p = await property();
    await invest(agent, p.id, '5000');
    const { from, to } = range();

    const res = await agent
      .get(`/api/v1/documents/statement?from=${from}&to=${to}`)
      .buffer()
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers['content-type']).toBe('application/pdf');
    expect(isPdf(res.body)).toBe(true);
  });

  it('works for somebody who has never funded an account', async () => {
    // No wallet at all is a real state, not an error — they still get a
    // statement, it just says nothing moved.
    await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ firstName: 'New', lastName: 'User', email: 'empty@example.com', password: PASSWORD });
    const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/verify-email').set('Origin', ORIGIN).send({ token });

    const { from, to } = range();
    await agent.get(`/api/v1/documents/statement?from=${from}&to=${to}`).expect(200);
  });

  it('refuses a missing or backwards range', async () => {
    const { agent } = await investor('badrange@example.com');
    await agent.get('/api/v1/documents/statement').expect(400);
    await agent
      .get('/api/v1/documents/statement?from=2026-06-01&to=2026-01-01')
      .expect(400);
  });

  it('refuses a period long enough to be a denial of service', async () => {
    const { agent } = await investor('huge@example.com');
    await agent
      .get('/api/v1/documents/statement?from=2000-01-01&to=2026-01-01')
      .expect(400);
  });

  it('needs a session', async () => {
    const { from, to } = range();
    await request(app).get(`/api/v1/documents/statement?from=${from}&to=${to}`).expect(401);
  });
});
