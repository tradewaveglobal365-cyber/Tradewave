import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { migrateTestDatabase, readCookie, resetDatabase } from './helpers';

const app = createApp();
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';

/** Captures the URLs the service would have emailed. */
const sent = { verify: [] as string[], reset: [] as string[], duplicate: [] as string[] };

beforeAll(() => {
  migrateTestDatabase();
  vi.spyOn(emailService, 'sendVerification').mockImplementation(async ({ verifyUrl }) => {
    sent.verify.push(verifyUrl);
  });
  vi.spyOn(emailService, 'sendPasswordReset').mockImplementation(async ({ resetUrl }) => {
    sent.reset.push(resetUrl);
  });
  vi.spyOn(emailService, 'sendDuplicateSignupNotice').mockImplementation(async ({ to }) => {
    sent.duplicate.push(to);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  sent.verify.length = 0;
  sent.reset.length = 0;
  sent.duplicate.length = 0;
});

const tokenFromUrl = (url: string): string => new URL(url).searchParams.get('token') ?? '';

async function registerUser(email: string, extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ firstName: 'Test', lastName: 'User', email, password: PASSWORD, ...extra });
}

/** Registers and verifies, returning the agent that holds the session cookies. */
async function registerAndVerify(email: string, extra: Record<string, unknown> = {}) {
  await registerUser(email, extra);
  const token = tokenFromUrl(sent.verify.at(-1)!);
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/verify-email').set('Origin', ORIGIN).send({ token });
  return { agent, user: res.body.user as { id: string; referralCode: string } };
}

describe('registration', () => {
  it('creates a pending user and emails a verification link', async () => {
    const res = await registerUser('new@example.com');
    expect(res.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'new@example.com' } });
    expect(user.status).toBe('PENDING_VERIFICATION');
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.referralCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(sent.verify).toHaveLength(1);
  });

  it('never stores the raw verification token', async () => {
    await registerUser('raw@example.com');
    const raw = tokenFromUrl(sent.verify[0]!);
    const stored = await prisma.verificationToken.findFirst();
    expect(stored!.tokenHash).not.toBe(raw);
    expect(stored!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not reveal that an email is already taken', async () => {
    await registerUser('dupe@example.com');
    const first = await registerUser('fresh@example.com');
    const second = await registerUser('dupe@example.com');

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(await prisma.user.count({ where: { email: 'dupe@example.com' } })).toBe(1);
    // The real owner is warned instead.
    expect(sent.duplicate).toContain('dupe@example.com');
  });

  it('rejects common passwords', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ firstName: 'A', lastName: 'B', email: 'weak@example.com', password: 'password123' });

    expect(res.status).toBe(422);
    expect(res.body.error.fields.password).toMatch(/too common/i);
  });

  it('normalises email casing and whitespace', async () => {
    await registerUser('  MiXeD@Example.COM  ');
    expect(await prisma.user.findUnique({ where: { email: 'mixed@example.com' } })).not.toBeNull();
  });
});

describe('email verification', () => {
  it('activates the account and signs the user in', async () => {
    await registerUser('verify@example.com');
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .send({ token: tokenFromUrl(sent.verify[0]!) });

    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('ACTIVE');
    expect(readCookie(res, 'tw_access')).toBeTruthy();
    expect(readCookie(res, 'tw_refresh')).toBeTruthy();
  });

  it('refuses a token that was already used', async () => {
    await registerUser('once@example.com');
    const token = tokenFromUrl(sent.verify[0]!);
    await request(app).post('/api/v1/auth/verify-email').set('Origin', ORIGIN).send({ token });

    const second = await request(app)
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .send({ token });

    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('INVALID_TOKEN');
  });

  it('refuses an expired token', async () => {
    await registerUser('expired@example.com');
    await prisma.verificationToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .send({ token: tokenFromUrl(sent.verify[0]!) });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/expired/i);
  });
});

describe('login', () => {
  it('signs in a verified user', async () => {
    await registerAndVerify('login@example.com');
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'login@example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(readCookie(res, 'tw_access')).toBeTruthy();
  });

  it('returns the same error for a wrong password and an unknown email', async () => {
    await registerAndVerify('real@example.com');

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'real@example.com', password: 'not-the-password' });

    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'ghost@example.com', password: 'not-the-password' });

    expect(wrongPassword.status).toBe(unknownEmail.status);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('locks the account after 5 failed attempts, even with the right password', async () => {
    await registerAndVerify('lock@example.com');

    for (let i = 0; i < 4; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: 'lock@example.com', password: 'wrong' });
      expect(res.status).toBe(401);
    }

    const fifth = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'lock@example.com', password: 'wrong' });
    expect(fifth.status).toBe(423);

    const correct = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'lock@example.com', password: PASSWORD });
    expect(correct.status).toBe(423);
  });
});

describe('refresh token rotation', () => {
  it('issues a different token on every refresh', async () => {
    const { agent } = await registerAndVerify('rotate@example.com');
    const before = await prisma.session.count();

    const res = await agent.post('/api/v1/auth/refresh').set('Origin', ORIGIN);
    expect(res.status).toBe(200);
    expect(await prisma.session.count()).toBe(before + 1);
  });

  it('revokes the whole family when a used token is replayed', async () => {
    await registerUser('replay@example.com');
    const verified = await request(app)
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .send({ token: tokenFromUrl(sent.verify[0]!) });

    const stolen = readCookie(verified, 'tw_refresh')!;

    // Honest rotation.
    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', `tw_refresh=${stolen}`);
    const current = readCookie(rotated, 'tw_refresh')!;
    expect(current).not.toBe(stolen);

    // Attacker replays the captured token.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', `tw_refresh=${stolen}`);
    expect(replay.status).toBe(401);

    // The honest user's still-valid token must die too.
    const honest = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', `tw_refresh=${current}`);
    expect(honest.status).toBe(401);

    const active = await prisma.session.count({ where: { revokedAt: null } });
    expect(active).toBe(0);
  });

  it('rejects an unknown refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', 'tw_refresh=not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('password reset', () => {
  it('always answers the same regardless of whether the account exists', async () => {
    await registerAndVerify('known@example.com');

    const real = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Origin', ORIGIN)
      .send({ email: 'known@example.com' });

    const fake = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Origin', ORIGIN)
      .send({ email: 'nobody@example.com' });

    expect(real.status).toBe(200);
    expect(fake.body).toEqual(real.body);
  });

  it('changes the password and kills every existing session', async () => {
    const { agent } = await registerAndVerify('reset@example.com');
    expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(1);

    await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Origin', ORIGIN)
      .send({ email: 'reset@example.com' });

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .set('Origin', ORIGIN)
      .send({ token: tokenFromUrl(sent.reset.at(-1)!), password: 'a whole new passphrase' });
    expect(res.status).toBe(200);

    // Old session is gone.
    expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(0);
    expect((await agent.post('/api/v1/auth/refresh').set('Origin', ORIGIN)).status).toBe(401);

    // Old password no longer works; new one does.
    const old = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'reset@example.com', password: PASSWORD });
    expect(old.status).toBe(401);

    const fresh = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'reset@example.com', password: 'a whole new passphrase' });
    expect(fresh.status).toBe(200);
  });
});

describe('CSRF origin check', () => {
  it('blocks a state-changing request from another origin', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example.com')
      .send({ email: 'a@b.co', password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows safe methods from anywhere', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(200);
  });
});
