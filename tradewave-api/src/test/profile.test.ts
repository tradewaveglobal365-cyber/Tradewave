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

const setKyc = (userId: string, kycStatus: string) =>
  prisma.user.update({ where: { id: userId }, data: { kycStatus: kycStatus as never } });

describe('editing your name', () => {
  it('is allowed before any identity check — the case this exists for', async () => {
    // Someone whose document reads "Joshua Okhaide" fixes their account to match
    // rather than being told to contact support.
    const { agent, userId } = await createUser('fix@example.com');

    const res = await agent
      .patch('/api/v1/auth/me')
      .set('Origin', ORIGIN)
      .send({ firstName: 'Joshua', lastName: 'Okhaide' })
      .expect(200);

    expect(res.body.user.lastName).toBe('Okhaide');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.lastName).toBe('Okhaide');
  });

  it('is allowed after a rejection, which is when it matters most', async () => {
    const { agent, userId } = await createUser('rejected@example.com');
    await setKyc(userId, 'REJECTED');

    await agent
      .patch('/api/v1/auth/me')
      .set('Origin', ORIGIN)
      .send({ lastName: 'Okhaide' })
      .expect(200);
  });

  it('is allowed after an expired session', async () => {
    const { agent, userId } = await createUser('expired@example.com');
    await setKyc(userId, 'EXPIRED');
    await agent
      .patch('/api/v1/auth/me')
      .set('Origin', ORIGIN)
      .send({ lastName: 'Okhaide' })
      .expect(200);
  });

  it('is LOCKED while a check is in flight', async () => {
    const { agent, userId } = await createUser('pending@example.com');
    await setKyc(userId, 'PENDING');

    const res = await agent
      .patch('/api/v1/auth/me')
      .set('Origin', ORIGIN)
      .send({ lastName: 'Changed' });

    expect(res.status).toBe(422);
    expect(res.body.error.fields.firstName).toMatch(/in progress/i);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.lastName).toBe('Okoghie');
  });

  it('is LOCKED once verified — a document attests to that name', async () => {
    // The integrity rule. Without it someone verifies as one person and then
    // renames the account, leaving a passed check attesting to somebody else.
    const { agent, userId } = await createUser('verified@example.com');
    await setKyc(userId, 'VERIFIED');

    const res = await agent
      .patch('/api/v1/auth/me')
      .set('Origin', ORIGIN)
      .send({ firstName: 'Someone', lastName: 'Else' });

    expect(res.status).toBe(422);
    expect(res.body.error.fields.firstName).toMatch(/verified/i);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.firstName).toBe('Joshua');
  });

  it('lets a verified user still change their phone', async () => {
    // Only the NAME is attested by the document. Locking everything would be
    // punishing the user for having verified.
    const { agent, userId } = await createUser('phone@example.com');
    await setKyc(userId, 'VERIFIED');

    await agent
      .patch('/api/v1/auth/me')
      .set('Origin', ORIGIN)
      .send({ phone: '+234 801 234 5678' })
      .expect(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.phone).toBe('+234 801 234 5678');
  });

  it('treats resubmitting the SAME name as no change', async () => {
    // The form sends every field. A verified user editing their phone must not
    // be blocked because the unchanged name came along for the ride.
    const { agent, userId } = await createUser('same@example.com');
    await setKyc(userId, 'VERIFIED');

    await agent
      .patch('/api/v1/auth/me')
      .set('Origin', ORIGIN)
      .send({ firstName: 'Joshua', lastName: 'Okoghie', phone: '+2348012345678' })
      .expect(200);
  });

  it('clears the phone when sent empty, and leaves it alone when absent', async () => {
    const { agent, userId } = await createUser('clear@example.com');
    await agent
      .patch('/api/v1/auth/me')
      .set('Origin', ORIGIN)
      .send({ phone: '+2348012345678' })
      .expect(200);

    await agent.patch('/api/v1/auth/me').set('Origin', ORIGIN).send({ firstName: 'Josh' }).expect(200);
    let row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.phone).toBe('+2348012345678');

    await agent.patch('/api/v1/auth/me').set('Origin', ORIGIN).send({ phone: '' }).expect(200);
    row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.phone).toBeNull();
  });

  it('rejects a name with characters a document would never carry', async () => {
    const { agent } = await createUser('bad@example.com');
    const res = await agent
      .patch('/api/v1/auth/me')
      .set('Origin', ORIGIN)
      .send({ firstName: '<script>alert(1)</script>' });
    expect(res.status).toBe(422);
  });

  it('refuses a signed-out caller', async () => {
    await request(app)
      .patch('/api/v1/auth/me')
      .set('Origin', ORIGIN)
      .send({ firstName: 'Nobody' })
      .expect(401);
  });
});
