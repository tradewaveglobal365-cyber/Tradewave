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
    .send({ firstName: 'Test', lastName: 'User', email, password: PASSWORD, phone: '08030000000', ...extra });
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
      .send({ firstName: 'A', lastName: 'B', email: 'weak@example.com', password: 'password123', phone: '08030000000' });

    expect(res.status).toBe(422);
    expect(res.body.error.fields.password).toMatch(/too common/i);
  });

  it('requires a phone number, and stores it normalised', async () => {
    // Optional until we found we could not reach a meaningful share of
    // investors about their own money. Still no OTP — captured, not proven.
    const missing = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ firstName: 'A', lastName: 'B', email: 'nophone@example.com', password: PASSWORD });
    expect(missing.status).toBe(422);
    expect(missing.body.error.fields.phone).toMatch(/required/i);
    expect(await prisma.user.count({ where: { email: 'nophone@example.com' } })).toBe(0);

    await registerUser('local@example.com', { phone: '0803 000 0000' });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'local@example.com' } });
    expect(user.phone).toBe('+2348030000000');
  });

  it('rejects a phone number it cannot resolve', async () => {
    const res = await registerUser('badphone@example.com', { phone: '0803000' });
    expect(res.status).toBe(422);
    expect(res.body.error.fields.phone).toMatch(/valid phone/i);
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
      .send({ identifier: 'login@example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(readCookie(res, 'tw_access')).toBeTruthy();
  });

  it('returns the same error for a wrong password and an unknown email', async () => {
    await registerAndVerify('real@example.com');

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ identifier: 'real@example.com', password: 'not-the-password' });

    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ identifier: 'ghost@example.com', password: 'not-the-password' });

    expect(wrongPassword.status).toBe(unknownEmail.status);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('locks the account after 5 failed attempts, even with the right password', async () => {
    await registerAndVerify('lock@example.com');

    for (let i = 0; i < 4; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .send({ identifier: 'lock@example.com', password: 'wrong' });
      expect(res.status).toBe(401);
    }

    const fifth = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ identifier: 'lock@example.com', password: 'wrong' });
    expect(fifth.status).toBe(423);

    const correct = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ identifier: 'lock@example.com', password: PASSWORD });
    expect(correct.status).toBe(423);
  });
});

describe('signing in with a phone number', () => {
  const signIn = (identifier: string, password = PASSWORD) =>
    request(app).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier, password });

  it('accepts every spelling of the same number', async () => {
    const { user } = await registerAndVerify('phone@example.com', { phone: '08031234567' });

    // Each of these is what the same person types on a different day. All four
    // must normalise to +2348031234567 and reach one account.
    for (const typed of ['08031234567', '+2348031234567', '2348031234567', '0803 123 4567']) {
      const res = await signIn(typed);
      expect(res.status, typed).toBe(200);
      expect(res.body.user.id, typed).toBe(user.id);
    }
  });

  it('refuses a number two accounts share, identically to an unknown one', async () => {
    const shared = '08039998888';
    await registerAndVerify('mum@example.com', { phone: shared });
    await registerAndVerify('son@example.com', { phone: shared });

    const ambiguous = await signIn(shared);
    const unknown = await signIn('08037776666');

    // Byte-identical, so nobody can use a sign-in attempt to learn that a
    // number has two accounts on it. Both of them still have their addresses.
    expect(ambiguous.status).toBe(401);
    expect(ambiguous.body).toEqual(unknown.body);

    // ...and the email addresses still work, which is the escape hatch the
    // login form points them at.
    await expect(signIn('mum@example.com').then((r) => r.status)).resolves.toBe(200);
    await expect(signIn('son@example.com').then((r) => r.status)).resolves.toBe(200);
  });

  it('still signs in by email when the account has no phone number at all', async () => {
    // Registered before the number became required. There is no route that
    // produces this any more, so it is made directly.
    const { user } = await registerAndVerify('legacy@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { phone: null } });

    const res = await signIn('legacy@example.com');
    expect(res.status).toBe(200);
  });

  it('counts failed phone attempts against the account, not the spelling', async () => {
    await registerAndVerify('lockbyphone@example.com', { phone: '08035554444' });

    // A different spelling each time. If the lockout keyed on the string that
    // was typed rather than the account it resolved to, this would never lock.
    const spellings = ['08035554444', '+2348035554444', '2348035554444', '0803 555 4444'];
    for (const typed of spellings) {
      expect((await signIn(typed, 'wrong')).status, typed).toBe(401);
    }

    expect((await signIn('08035554444', 'wrong')).status).toBe(423);
    // Locked to the ACCOUNT: the right password on the email address is
    // refused too.
    expect((await signIn('lockbyphone@example.com')).status).toBe(423);
  });

  it('answers garbage the same way it answers a miss, never a 500', async () => {
    await registerAndVerify('solid@example.com', { phone: '08032223333' });

    // All of these reach login() and come back as an ordinary miss. That is
    // the point: the schema deliberately does NOT reject a malformed
    // identifier, because a different response for "that isn't a phone
    // number" than for "no such account" is a free probe.
    for (const junk of ['not-a-number', '@', '+', '00000', 'x'.repeat(200)]) {
      const res = await signIn(junk);
      expect(res.status, junk).toBe(401);
    }

    // An EMPTY identifier is the one exception, and it is a form error rather
    // than a credentials check — there is nothing to be told about.
    const blank = await signIn('   ');
    expect(blank.status).toBe(422);
  });
});

describe('forgetting a password with a phone number', () => {
  const forgot = (identifier: string) =>
    request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Origin', ORIGIN)
      .send({ identifier });

  it('sends the reset link to the address on the account', async () => {
    await registerAndVerify('byphone@example.com', { phone: '08036667777' });

    const res = await forgot('08036667777');
    expect(res.status).toBe(200);
    expect(sent.reset).toHaveLength(1);

    // The link itself must work — there is no SMS, so a number gets you a
    // reset only because we mail it to the address we already hold.
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .set('Origin', ORIGIN)
      .send({ token: tokenFromUrl(sent.reset[0]!), password: 'a whole new passphrase' });
    expect(reset.status).toBe(200);
  });

  it('issues nothing for a number two accounts share, and still returns 200', async () => {
    await registerAndVerify('one@example.com', { phone: '08034445555' });
    await registerAndVerify('two@example.com', { phone: '08034445555' });

    const res = await forgot('08034445555');
    expect(res.status).toBe(200);
    expect(sent.reset).toHaveLength(0);
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

    // Past the grace window, so this is a replay rather than a second tab.
    // Backdated in the database instead of faking timers: the production code
    // reads Date.now() in one place and the clock is not what is under test.
    await prisma.session.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

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

  /**
   * The case that used to sign people out: two tabs, both refreshing after the
   * access token expired, the slower one presenting a token the faster one has
   * already rotated. That is a race, not a theft, and it must not end the
   * session.
   */
  it('tolerates a concurrent refresh inside the grace window', async () => {
    await registerUser('race@example.com');
    const verified = await request(app)
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .send({ token: tokenFromUrl(sent.verify[0]!) });

    const shared = readCookie(verified, 'tw_refresh')!;

    const first = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', `tw_refresh=${shared}`)
      .expect(200);

    // Second tab, same starting token, no backdating — inside the window.
    const second = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', `tw_refresh=${shared}`)
      .expect(200);

    // Each got its own token, and the session survived.
    const a = readCookie(first, 'tw_refresh')!;
    const b = readCookie(second, 'tw_refresh')!;
    expect(a).not.toBe(shared);
    expect(b).not.toBe(shared);
    expect(a).not.toBe(b);
    expect(await prisma.session.count({ where: { revokedAt: null } })).toBeGreaterThan(0);

    // And the newest token still works, which is what the user experiences.
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', `tw_refresh=${b}`)
      .expect(200);
  });

  it('sends the refresh cookie site-wide so middleware can see it', async () => {
    // Scoped to /api/v1/auth it was invisible to Next middleware on /dashboard,
    // which is the only place able to set a fresh cookie — so nothing ever
    // refreshed. Path is load-bearing, not cosmetic.
    await registerUser('path@example.com');
    const verified = await request(app)
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .send({ token: tokenFromUrl(sent.verify[0]!) });

    const header = verified.headers['set-cookie'] as unknown as string[];
    const refresh = header.find((c) => c.startsWith('tw_refresh='))!;
    expect(refresh).toMatch(/Path=\/(;|$)/);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/SameSite=Lax/i);
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
      .send({ identifier: 'known@example.com' });

    const fake = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Origin', ORIGIN)
      .send({ identifier: 'nobody@example.com' });

    expect(real.status).toBe(200);
    expect(fake.body).toEqual(real.body);
  });

  it('changes the password and kills every existing session', async () => {
    const { agent } = await registerAndVerify('reset@example.com');
    expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(1);

    await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Origin', ORIGIN)
      .send({ identifier: 'reset@example.com' });

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
      .send({ identifier: 'reset@example.com', password: PASSWORD });
    expect(old.status).toBe(401);

    const fresh = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ identifier: 'reset@example.com', password: 'a whole new passphrase' });
    expect(fresh.status).toBe(200);
  });
});

describe('CSRF origin check', () => {
  it('blocks a state-changing request from another origin', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example.com')
      .send({ identifier: 'a@b.co', password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows safe methods from anywhere', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(200);
  });
});

// ── Changing a password while signed in ──────────────────────────────────────

/**
 * The assertions that matter are the session ones. Changing a password has to
 * evict anybody else holding a session, and must NOT evict the person doing it
 * — being signed out of the session you just used to prove who you are teaches
 * people that securing their account costs them something.
 */
describe('changing the password while signed in', () => {
  const NEW_PASSWORD = 'a much better passphrase here';

  async function signedIn(email: string) {
    await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ firstName: 'Joshua', lastName: 'Okoghie', email, password: PASSWORD, phone: '08030000000' });
    const token = new URL(sent.verify.at(-1)!).searchParams.get('token')!;
    const agent = request.agent(app);
    const res = await agent
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .send({ token });
    return { agent, userId: res.body.user.id as string };
  }

  /** A second signed-in device for the same account. */
  async function secondDevice(email: string) {
    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ identifier: email, password: PASSWORD })
      .expect(200);
    return agent;
  }

  const change = (
    agent: ReturnType<typeof request.agent>,
    currentPassword: string,
    password: string,
  ) =>
    agent
      .post('/api/v1/auth/change-password')
      .set('Origin', ORIGIN)
      .send({ currentPassword, password });

  it('changes the password and lets the new one sign in', async () => {
    const { agent } = await signedIn('change@example.com');
    await change(agent, PASSWORD, NEW_PASSWORD).expect(200);

    const fresh = request.agent(app);
    await fresh
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ identifier: 'change@example.com', password: NEW_PASSWORD })
      .expect(200);
  });

  it('stops the old password working', async () => {
    const { agent } = await signedIn('oldgone@example.com');
    await change(agent, PASSWORD, NEW_PASSWORD).expect(200);

    await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ identifier: 'oldgone@example.com', password: PASSWORD })
      .expect(401);
  });

  /**
   * The gate that turns "has a session" into "knows the secret". Without it an
   * unattended laptop is a permanently stolen account.
   */
  it('refuses without the correct current password, and changes nothing', async () => {
    const { agent } = await signedIn('wrongcurrent@example.com');

    const res = await change(agent, 'not the right one', NEW_PASSWORD);
    expect(res.status).toBe(422);
    expect(res.body.error.fields.currentPassword).toBeTruthy();

    // The old password still works, so nothing was written.
    await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ identifier: 'wrongcurrent@example.com', password: PASSWORD })
      .expect(200);
  });

  it('refuses a new password that is the same as the old one', async () => {
    const { agent } = await signedIn('same@example.com');
    const res = await change(agent, PASSWORD, PASSWORD);
    expect(res.status).toBe(422);
    expect(res.body.error.fields.password).toBeTruthy();
  });

  it('refuses a weak or breached new password', async () => {
    const { agent } = await signedIn('weak@example.com');
    await change(agent, PASSWORD, 'short').expect(422);
    await change(agent, PASSWORD, 'password123').expect(422);
  });

  it('needs a session at all', async () => {
    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Origin', ORIGIN)
      .send({ currentPassword: PASSWORD, password: NEW_PASSWORD })
      .expect(401);
  });

  /** Evicting an attacker is the point of the whole feature. */
  it('signs out every OTHER device', async () => {
    const { agent } = await signedIn('evict@example.com');
    const other = await secondDevice('evict@example.com');

    // The other device works before the change.
    await other.get('/api/v1/auth/me').expect(200);

    const res = await change(agent, PASSWORD, NEW_PASSWORD).expect(200);
    expect(res.body.otherSessionsEnded).toBeGreaterThanOrEqual(1);

    // Its refresh token is dead, so it cannot get a new access token.
    await other.post('/api/v1/auth/refresh').set('Origin', ORIGIN).expect(401);
  });

  /** And does NOT sign out the person who just did it. */
  it('keeps the session that made the change', async () => {
    const { agent } = await signedIn('stayin@example.com');
    await change(agent, PASSWORD, NEW_PASSWORD).expect(200);

    await agent.get('/api/v1/auth/me').expect(200);
    await agent.post('/api/v1/auth/refresh').set('Origin', ORIGIN).expect(200);
  });

  it('tells the account owner it happened', async () => {
    const sent = vi.spyOn(emailService, 'sendPasswordChanged').mockResolvedValue();
    sent.mockClear();
    const { agent } = await signedIn('notified@example.com');

    await change(agent, PASSWORD, NEW_PASSWORD).expect(200);

    expect(sent).toHaveBeenCalledOnce();
    expect(sent.mock.calls[0]![0]).toMatchObject({ to: 'notified@example.com' });
  });

  it('burns any outstanding reset link', async () => {
    const { agent, userId } = await signedIn('burnreset@example.com');
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Origin', ORIGIN)
      .send({ identifier: 'burnreset@example.com' })
      .expect(200);

    await change(agent, PASSWORD, NEW_PASSWORD).expect(200);

    const outstanding = await prisma.verificationToken.count({
      where: { userId, type: 'PASSWORD_RESET', consumedAt: null },
    });
    expect(outstanding).toBe(0);
  });
});
