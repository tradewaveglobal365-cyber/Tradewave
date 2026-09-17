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

// ── Earning ──────────────────────────────────────────────────────────────────

/**
 * The referrer is paid 1% of what the person they invited invests, once, on
 * that person's first investment, credited in the same transaction.
 *
 * The assertions that matter are the ones about the SECOND investment and the
 * rollback: paying twice, or paying for an investment that did not happen, are
 * both money invented from nothing.
 */
describe('referral earnings', () => {
  async function property() {
    return prisma.property.create({
      data: {
        slug: `ref-${Math.random().toString(36).slice(2, 10)}`,
        title: 'Referral Tower',
        summary: 's',
        description: 'd',
        addressLine: 'a',
        area: 'Downtown Dubai',
        city: 'Dubai',
        images: [],
        totalValueCents: 100_000_000n,
        minInvestmentCents: 100_000n, // $1,000
        annualReturnBps: 800,
        termMonths: 24,
        status: 'OPEN',
      },
    });
  }

  /** A verified investor with a funded wallet, optionally invited by someone. */
  async function investorWithFunds(email: string, referredById?: string) {
    await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ firstName: 'Ada', lastName: 'Invitee', email, password: PASSWORD });
    const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
    const agent = request.agent(app);
    const res = await agent
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .send({ token });
    const userId = res.body.user.id as string;

    await prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: 'VERIFIED',
        kycVerifiedAt: new Date(),
        ...(referredById ? { referredById, referredAt: new Date() } : {}),
      },
    });
    await prisma.wallet.create({ data: { userId, balanceCents: 5_000_000n } }); // $50,000
    return { agent, userId };
  }

  async function referrer(email: string) {
    await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ firstName: 'Joshua', lastName: 'Referrer', email, password: PASSWORD });
    const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
    const agent = request.agent(app);
    const res = await agent
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .send({ token });
    return { agent, userId: res.body.user.id as string };
  }

  const invest = (
    agent: ReturnType<typeof request.agent>,
    propertyId: string,
    amountCents: string,
  ) =>
    agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId, amountCents });

  async function balanceOf(userId: string) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    return wallet?.balanceCents ?? 0n;
  }

  it('pays the referrer 1% when their invitee first invests', async () => {
    const boss = await referrer('earner@example.com');
    const invitee = await investorWithFunds('invited@example.com', boss.userId);
    const p = await property();

    // $2,000 invested → $20 bonus.
    await invest(invitee.agent, p.id, '200000').expect(201);

    expect(await balanceOf(boss.userId)).toBe(2_000n);

    const entries = await prisma.ledgerEntry.findMany({
      where: { type: 'REFERRAL_BONUS' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amountCents).toBe(2_000n);
    expect(entries[0]!.balanceAfterCents).toBe(2_000n);
    expect(entries[0]!.description).toBe('Referral bonus');
  });

  it('pays once — the invitee’s second investment earns nothing more', async () => {
    const boss = await referrer('once@example.com');
    const invitee = await investorWithFunds('twice@example.com', boss.userId);
    const p = await property();

    await invest(invitee.agent, p.id, '200000').expect(201);
    await invest(invitee.agent, p.id, '500000').expect(201);

    expect(await balanceOf(boss.userId)).toBe(2_000n);
    expect(await prisma.ledgerEntry.count({ where: { type: 'REFERRAL_BONUS' } })).toBe(1);
  });

  it('pays nothing when nobody invited them', async () => {
    const invitee = await investorWithFunds('nobody@example.com');
    const p = await property();

    await invest(invitee.agent, p.id, '200000').expect(201);
    expect(await prisma.ledgerEntry.count({ where: { type: 'REFERRAL_BONUS' } })).toBe(0);
  });

  it('pays nothing to a suspended referrer', async () => {
    const boss = await referrer('suspended@example.com');
    await prisma.user.update({ where: { id: boss.userId }, data: { status: 'SUSPENDED' } });
    const invitee = await investorWithFunds('undersuspended@example.com', boss.userId);
    const p = await property();

    await invest(invitee.agent, p.id, '200000').expect(201);
    expect(await balanceOf(boss.userId)).toBe(0n);
  });

  /**
   * The bonus rides the investment's transaction. A refused investment must
   * leave no trace of a bonus, or we have paid somebody for nothing.
   */
  it('pays nothing when the investment itself fails', async () => {
    const boss = await referrer('norollback@example.com');
    const invitee = await investorWithFunds('poor@example.com', boss.userId);
    await prisma.wallet.update({
      where: { userId: invitee.userId },
      data: { balanceCents: 100_000n }, // exactly the minimum, so $2,000 fails
    });
    const p = await property();

    await invest(invitee.agent, p.id, '200000').expect(422);

    expect(await balanceOf(boss.userId)).toBe(0n);
    expect(await prisma.ledgerEntry.count({ where: { type: 'REFERRAL_BONUS' } })).toBe(0);
  });

  it('keeps the referrer’s books balanced', async () => {
    const boss = await referrer('balanced@example.com');
    const invitee = await investorWithFunds('balancedinvitee@example.com', boss.userId);
    const p = await property();
    await invest(invitee.agent, p.id, '350000').expect(201);

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: boss.userId },
      include: { entries: true },
    });
    const sum = wallet.entries.reduce((acc, e) => acc + e.amountCents, 0n);
    expect(sum).toBe(wallet.balanceCents);
    expect(wallet.balanceCents).toBe(3_500n); // 1% of $3,500
  });

  it('reports earnings and the rate on the referral summary', async () => {
    const boss = await referrer('summary@example.com');
    const invitee = await investorWithFunds('summaryinvitee@example.com', boss.userId);
    const p = await property();
    await invest(invitee.agent, p.id, '200000').expect(201);

    const res = await boss.agent.get('/api/v1/referrals/me').expect(200);
    expect(res.body).toMatchObject({
      totalReferrals: 1,
      investedReferrals: 1,
      earnedCents: '2000',
      bonusBps: 100,
    });
  });

  it('tells the referrer they were paid, naming the invitee only by initial', async () => {
    // mockClear because this file sets its email spies in beforeAll and so has
    // no restoreAllMocks between tests — call history would carry over.
    const sent = vi.spyOn(emailService, 'sendReferralBonus').mockResolvedValue();
    sent.mockClear();
    const boss = await referrer('emailed@example.com');
    const invitee = await investorWithFunds('emailedinvitee@example.com', boss.userId);
    const p = await property();

    await invest(invitee.agent, p.id, '200000').expect(201);

    expect(sent).toHaveBeenCalledOnce();
    expect(sent.mock.calls[0]![0]).toMatchObject({
      to: 'emailed@example.com',
      amount: '$20.00',
      rate: '1%',
      inviteeName: 'Ada I.',
    });
  });

  it('does not email when no bonus was owed', async () => {
    const sent = vi.spyOn(emailService, 'sendReferralBonus').mockResolvedValue();
    sent.mockClear();
    const invitee = await investorWithFunds('noreferrer@example.com');
    const p = await property();

    await invest(invitee.agent, p.id, '200000').expect(201);
    expect(sent).not.toHaveBeenCalled();
  });

  /**
   * The bonus is already in the wallet by the time this runs. A mail provider
   * having a bad afternoon must not turn that into a failed investment.
   */
  it('still completes the investment when the bonus email fails', async () => {
    vi.spyOn(emailService, 'sendReferralBonus').mockRejectedValue(new Error('resend down'));
    const boss = await referrer('mailfail@example.com');
    const invitee = await investorWithFunds('mailfailinvitee@example.com', boss.userId);
    const p = await property();

    await invest(invitee.agent, p.id, '200000').expect(201);
    expect(await balanceOf(boss.userId)).toBe(2_000n);
  });

  it('shows zero earnings before anyone invests', async () => {
    const boss = await referrer('zero@example.com');
    await investorWithFunds('notyet@example.com', boss.userId);

    const res = await boss.agent.get('/api/v1/referrals/me').expect(200);
    expect(res.body).toMatchObject({
      totalReferrals: 1,
      investedReferrals: 0,
      earnedCents: '0',
    });
  });
});
