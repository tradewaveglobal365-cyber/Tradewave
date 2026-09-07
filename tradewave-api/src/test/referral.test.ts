import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { maskEmail } from '../modules/referral/referral.service';
import { generateReferralCode } from '../lib/crypto';
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
  verifyUrls.length = 0;
});

async function createVerifiedUser(email: string, referralCode?: string) {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email,
      password: PASSWORD,
      ...(referralCode ? { referralCode } : {}),
    });

  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/verify-email').set('Origin', ORIGIN).send({ token });
  return { agent, user: res.body.user as { id: string; referralCode: string } };
}

describe('referral code generation', () => {
  it('avoids glyphs that are ambiguous when read aloud or typed', () => {
    const codes = Array.from({ length: 500 }, () => generateReferralCode());
    for (const code of codes) {
      expect(code).toHaveLength(8);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it('produces distinct codes across users', async () => {
    const a = await createVerifiedUser('a@example.com');
    const b = await createVerifiedUser('b@example.com');
    expect(a.user.referralCode).not.toBe(b.user.referralCode);
  });
});

describe('referral capture at signup', () => {
  it('links the invitee to the referrer in the same write as user creation', async () => {
    const { user: referrer } = await createVerifiedUser('referrer@example.com');
    await createVerifiedUser('invitee@example.com', referrer.referralCode);

    const invitee = await prisma.user.findUniqueOrThrow({
      where: { email: 'invitee@example.com' },
    });
    expect(invitee.referredById).toBe(referrer.id);
    expect(invitee.referredAt).not.toBeNull();
  });

  it('accepts a lowercase code', async () => {
    const { user: referrer } = await createVerifiedUser('up@example.com');
    await createVerifiedUser('down@example.com', referrer.referralCode.toLowerCase());

    const invitee = await prisma.user.findUniqueOrThrow({ where: { email: 'down@example.com' } });
    expect(invitee.referredById).toBe(referrer.id);
  });

  it('still registers the user when the code does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({
        firstName: 'No',
        lastName: 'Ref',
        email: 'noref@example.com',
        password: PASSWORD,
        referralCode: 'ZZZZZZZZ',
      });

    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'noref@example.com' } });
    expect(user.referredById).toBeNull();
  });

  it('rejects a malformed code at validation rather than silently dropping it', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({
        firstName: 'Bad',
        lastName: 'Code',
        email: 'bad@example.com',
        password: PASSWORD,
        referralCode: 'SHORT',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.fields.referralCode).toBeTruthy();
  });

  it('ignores a code belonging to a suspended user', async () => {
    const { user: referrer } = await createVerifiedUser('suspended@example.com');
    await prisma.user.update({ where: { id: referrer.id }, data: { status: 'SUSPENDED' } });

    await createVerifiedUser('victim@example.com', referrer.referralCode);
    const invitee = await prisma.user.findUniqueOrThrow({ where: { email: 'victim@example.com' } });
    expect(invitee.referredById).toBeNull();
  });
});

describe('referral endpoints', () => {
  it('returns a share url containing the code', async () => {
    const { agent, user } = await createVerifiedUser('share@example.com');
    const res = await agent.get('/api/v1/referrals/me');

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(user.referralCode);
    expect(res.body.shareUrl).toContain(`?ref=${user.referralCode}`);
  });

  it('counts total and verified invitees separately', async () => {
    const { agent, user } = await createVerifiedUser('counter@example.com');
    await createVerifiedUser('verified-invitee@example.com', user.referralCode);

    // A second invitee who never verifies.
    await request(app).post('/api/v1/auth/register').set('Origin', ORIGIN).send({
      firstName: 'Un',
      lastName: 'Verified',
      email: 'pending-invitee@example.com',
      password: PASSWORD,
      referralCode: user.referralCode,
    });

    const res = await agent.get('/api/v1/referrals/me');
    expect(res.body.totalReferrals).toBe(2);
    expect(res.body.verifiedReferrals).toBe(1);
  });

  it('never exposes an invitee full email address', async () => {
    const { agent, user } = await createVerifiedUser('privacy@example.com');
    await createVerifiedUser('sensitive.address@example.com', user.referralCode);

    const res = await agent.get('/api/v1/referrals/list');
    const body = JSON.stringify(res.body);

    expect(res.body.items).toHaveLength(1);
    expect(body).not.toContain('sensitive.address@example.com');
    expect(res.body.items[0].maskedEmail).toBe('se***************@example.com');
    expect(res.body.items[0].displayName).toBe('Ada L.');
  });

  it('requires authentication for the summary', async () => {
    const res = await request(app).get('/api/v1/referrals/me');
    expect(res.status).toBe(401);
  });

  it('validates a code publicly, exposing only a first name', async () => {
    const { user } = await createVerifiedUser('public@example.com');
    const res = await request(app).get(`/api/v1/referrals/validate/${user.referralCode}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true, referrerFirstName: 'Ada' });
  });

  it('reports an unknown code as invalid without erroring', async () => {
    const res = await request(app).get('/api/v1/referrals/validate/ZZZZZZZZ');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false });
  });
});

describe('maskEmail', () => {
  it('keeps the domain and the first two characters', () => {
    expect(maskEmail('joshua@gmail.com')).toBe('jo****@gmail.com');
    expect(maskEmail('ab@x.co')).toBe('ab***@x.co');
    expect(maskEmail('a@x.co')).toBe('a***@x.co');
  });
});
