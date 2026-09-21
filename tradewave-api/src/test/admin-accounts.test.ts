import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { dollarsToCents } from '../lib/money';
import { migrateTestDatabase, resetDatabase } from './helpers';

/**
 * Staff control over investor accounts.
 *
 * The assertions that matter most are the ones about a freeze actually biting:
 * that it survives a token minted before it, that it reaches a withdrawal
 * already in the queue, and that it takes admin away from staff. A suspend
 * button that does not suspend anything is worse than no button at all.
 */

const app = createApp();
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';
const REASON = 'Suspected account takeover, reported by the investor';

const verifyUrls: string[] = [];

beforeAll(() => {
  migrateTestDatabase();
  vi.spyOn(emailService, 'sendVerification').mockImplementation(async ({ verifyUrl }) => {
    verifyUrls.push(verifyUrl);
  });
  vi.spyOn(emailService, 'sendDuplicateSignupNotice').mockResolvedValue();
  vi.spyOn(emailService, 'sendInvestmentConfirmed').mockResolvedValue();
  vi.spyOn(emailService, 'sendAccountStatusChanged').mockResolvedValue();
  vi.spyOn(emailService, 'sendKycResetRequired').mockResolvedValue();
  vi.spyOn(emailService, 'sendBalanceAdjusted').mockResolvedValue();
  vi.spyOn(emailService, 'sendWithdrawalRequested').mockResolvedValue();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.property.deleteMany();
  verifyUrls.length = 0;
  // The payout schedule is not what these tests are about.
  await prisma.withdrawalWindow.upsert({
    where: { id: 'singleton' },
    update: { enabled: false, paused: false, pausedReason: null },
    create: { id: 'singleton', enabled: false },
  });
});

async function signUp(email: string) {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ firstName: 'Joshua', lastName: 'Okoghie', email, password: PASSWORD, phone: '08030000000' });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/verify-email').set('Origin', ORIGIN).send({ token });
  return { agent, userId: res.body.user.id as string };
}

/** A verified investor with a funded wallet and a settled payout account. */
async function investor(email: string, balance = '50000') {
  const { agent, userId } = await signUp(email);
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
  await prisma.payoutAccount.create({
    data: {
      userId,
      bankCode: '044',
      bankName: 'Access Bank',
      accountNumber: '0690000032',
      accountName: 'OKOGHIE JOSHUA',
      nameResolved: true,
      destinationChangedAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
    },
  });
  return { agent, userId };
}

async function admin(email: string) {
  const { agent, userId } = await signUp(email);
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
  return { agent, userId };
}

const act = (
  staff: ReturnType<typeof request.agent>,
  userId: string,
  path: string,
  body: Record<string, unknown>,
) => staff.post(`/api/v1/admin/investors/${userId}/${path}`).set('Origin', ORIGIN).send(body);

const setStatus = (
  staff: ReturnType<typeof request.agent>,
  userId: string,
  action: string,
  reason = REASON,
) => act(staff, userId, 'status', { action, reason });

const login = (email: string) =>
  request(app).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD });

const balanceOf = async (userId: string) =>
  (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balanceCents;

// ── Suspension ───────────────────────────────────────────────────────────────

describe('suspending an account', () => {
  it('blocks login, and reinstating restores it', async () => {
    const { userId } = await investor('suspend@example.com');
    const staff = await admin('staff1@example.com');

    await setStatus(staff.agent, userId, 'suspend').expect(200);
    const refused = await login('suspend@example.com');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('ACCOUNT_SUSPENDED');

    await setStatus(staff.agent, userId, 'reinstate').expect(200);
    await login('suspend@example.com').expect(200);
  });

  /**
   * The freeze has to bite on a token issued BEFORE it. requireActive used to
   * read the JWT, which made every suspension up to fifteen minutes late.
   */
  it('bites on a session that was already signed in', async () => {
    const { agent, userId } = await investor('already@example.com');
    const staff = await admin('staff2@example.com');

    await agent.get('/api/v1/wallet/payout-account').expect(200);
    await setStatus(staff.agent, userId, 'suspend').expect(200);

    const res = await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send({ bankCode: '044', accountNumber: '0690000032', accountName: 'OKOGHIE JOSHUA' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('ends every session, so the refresh token stops working', async () => {
    const { agent, userId } = await investor('sessions@example.com');
    const staff = await admin('staff3@example.com');

    await agent.post('/api/v1/auth/refresh').set('Origin', ORIGIN).expect(200);
    await setStatus(staff.agent, userId, 'suspend').expect(200);
    await agent.post('/api/v1/auth/refresh').set('Origin', ORIGIN).expect(401);
  });

  it('refuses to suspend an account twice', async () => {
    const { userId } = await investor('twice@example.com');
    const staff = await admin('staff4@example.com');
    await setStatus(staff.agent, userId, 'suspend').expect(200);
    await setStatus(staff.agent, userId, 'suspend').expect(400);
  });

  it('refuses to act on your own account', async () => {
    const staff = await admin('self@example.com');
    await setStatus(staff.agent, staff.userId, 'suspend').expect(400);
  });

  /** The live hole: requireRole read the role column and nothing else. */
  it('takes the admin console away from suspended staff', async () => {
    const rogue = await admin('rogue@example.com');
    const boss = await admin('boss@example.com');

    await rogue.agent.get('/api/v1/admin/investors').expect(200);
    await setStatus(boss.agent, rogue.userId, 'suspend').expect(200);
    await rogue.agent.get('/api/v1/admin/investors').expect(403);
  });

  it('does not un-suspend somebody by confirming their email', async () => {
    const { userId } = await signUp('pendingverify@example.com');
    const staff = await admin('staff5@example.com');
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: null } });

    await setStatus(staff.agent, userId, 'suspend').expect(200);
    await act(staff.agent, userId, 'verify-email', { reason: REASON }).expect(200);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(fresh.status).toBe('SUSPENDED');
    expect(fresh.emailVerifiedAt).not.toBeNull();
  });
});

// ── Restriction ──────────────────────────────────────────────────────────────

describe('restricting an account', () => {
  it('still lets them sign in and read everything', async () => {
    const { userId } = await investor('restrict@example.com');
    const staff = await admin('staff6@example.com');

    await setStatus(staff.agent, userId, 'restrict').expect(200);

    // A new sign-in works — this is the whole difference from suspension.
    const fresh = request.agent(app);
    await fresh
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'restrict@example.com', password: PASSWORD })
      .expect(200);

    await fresh.get('/api/v1/wallet').expect(200);
    await fresh.get('/api/v1/portfolio').expect(200);
    await fresh.get('/api/v1/documents').expect(200);
  });

  it('stops every way of moving money', async () => {
    const { userId } = await investor('frozen@example.com');
    const staff = await admin('staff7@example.com');
    await setStatus(staff.agent, userId, 'restrict').expect(200);

    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'frozen@example.com', password: PASSWORD })
      .expect(200);

    const property = await prisma.property.create({
      data: {
        slug: 'frozen-tower',
        title: 'T',
        summary: 's',
        description: 'd',
        addressLine: 'a',
        area: 'Downtown Dubai',
        city: 'Dubai',
        images: [],
        totalValueCents: dollarsToCents('100000'),
        minInvestmentCents: dollarsToCents('1000'),
        annualReturnBps: 800,
        termMonths: 24,
        status: 'OPEN',
      },
    });

    for (const res of [
      await agent.post('/api/v1/wallet/withdrawals').set('Origin', ORIGIN).send({ amountCents: '5000' }),
      await agent
        .post('/api/v1/investments')
        .set('Origin', ORIGIN)
        .send({ propertyId: property.id, amountCents: String(dollarsToCents('1000')) }),
      await agent
        .put('/api/v1/wallet/payout-account')
        .set('Origin', ORIGIN)
        .send({ bankCode: '044', accountNumber: '0690000032', accountName: 'OKOGHIE JOSHUA' }),
      await agent.get('/api/v1/wallet/deposit-account'),
      await agent.post('/api/v1/kyc/submit').set('Origin', ORIGIN).send({ consent: true }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_RESTRICTED');
    }
  });

  it('can be lifted', async () => {
    const { userId } = await investor('unrestrict@example.com');
    const staff = await admin('staff8@example.com');
    await setStatus(staff.agent, userId, 'restrict').expect(200);
    await setStatus(staff.agent, userId, 'unrestrict').expect(200);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(fresh.status).toBe('ACTIVE');
  });
});

// ── Withdrawal blocks ────────────────────────────────────────────────────────

describe('blocking withdrawals', () => {
  it('stops withdrawals and leaves everything else working', async () => {
    const { agent, userId } = await investor('blocked@example.com');
    const staff = await admin('staff9@example.com');

    await act(staff.agent, userId, 'withdrawals', { action: 'block', reason: REASON }).expect(200);

    const refused = await agent
      .post('/api/v1/wallet/withdrawals')
      .set('Origin', ORIGIN)
      .send({ amountCents: '5000' });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('WITHDRAWALS_BLOCKED');

    // Not frozen otherwise.
    await agent.get('/api/v1/wallet').expect(200);
    await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send({ bankCode: '044', accountNumber: '0690000032', accountName: 'OKOGHIE JOSHUA' })
      .expect(200);

    await act(staff.agent, userId, 'withdrawals', { action: 'unblock', reason: REASON }).expect(200);
    await agent
      .post('/api/v1/wallet/withdrawals')
      .set('Origin', ORIGIN)
      .send({ amountCents: '5000' })
      .expect(201);
  });

  /** The payment a freeze exists to stop is the one already in the queue. */
  it('refuses to approve a withdrawal for a suspended investor', async () => {
    const { agent, userId } = await investor('inflight@example.com');
    const staff = await admin('staff10@example.com');
    await prisma.fxRate.create({
      data: { baseCurrency: 'USD', quoteCurrency: 'NGN', minorPerUnit: 165_000n },
    });

    const res = await agent
      .post('/api/v1/wallet/withdrawals')
      .set('Origin', ORIGIN)
      .send({ amountCents: '20000' })
      .expect(201);

    await setStatus(staff.agent, userId, 'suspend').expect(200);

    const approve = await staff.agent
      .post(`/api/v1/admin/withdrawals/${res.body.withdrawal.id}/approve`)
      .set('Origin', ORIGIN);
    expect(approve.status).toBe(400);
    expect(approve.body.error.message).toMatch(/suspended/i);
  });

  it('flags a frozen investor on the queue', async () => {
    const { agent, userId } = await investor('flagged@example.com');
    const staff = await admin('staff11@example.com');
    await agent
      .post('/api/v1/wallet/withdrawals')
      .set('Origin', ORIGIN)
      .send({ amountCents: '5000' })
      .expect(201);

    await setStatus(staff.agent, userId, 'restrict').expect(200);

    const queue = await staff.agent.get('/api/v1/admin/withdrawals').expect(200);
    expect(queue.body.withdrawals[0].investorFrozen).toBe(true);
    expect(queue.body.withdrawals[0].investorStatus).toBe('RESTRICTED');
  });
});

describe('pausing withdrawals for everybody', () => {
  const pause = (staff: ReturnType<typeof request.agent>, paused: boolean, reason?: string) =>
    staff
      .post('/api/v1/admin/withdrawal-window')
      .set('Origin', ORIGIN)
      .send({
        paused,
        ...(reason ? { pausedReason: reason } : {}),
        enabled: false,
        daysOfWeek: [5],
        opensAtMinute: 540,
        closesAtMinute: 1_020,
        timezone: 'Africa/Lagos',
      });

  it('refuses every withdrawal, and says why', async () => {
    const { agent } = await investor('paused@example.com');
    const staff = await admin('staff12@example.com');

    await pause(staff.agent, true, 'Our payment provider is down').expect(200);

    const res = await agent
      .post('/api/v1/wallet/withdrawals')
      .set('Origin', ORIGIN)
      .send({ amountCents: '5000' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WITHDRAWALS_PAUSED');
    expect(res.body.error.message).toMatch(/payment provider is down/);

    await pause(staff.agent, false).expect(200);
    await agent
      .post('/api/v1/wallet/withdrawals')
      .set('Origin', ORIGIN)
      .send({ amountCents: '5000' })
      .expect(201);
  });

  it('insists on a reason for the pause', async () => {
    const staff = await admin('staff13@example.com');
    await pause(staff.agent, true).expect(400);
  });
});

// ── Identity ─────────────────────────────────────────────────────────────────

describe('forcing re-verification', () => {
  it('sends them back to EXPIRED, not REJECTED, and clears the timestamp', async () => {
    const { userId } = await investor('reverify@example.com');
    const staff = await admin('staff14@example.com');

    await act(staff.agent, userId, 'kyc-reset', { reason: 'Document expired' }).expect(200);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // EXPIRED is retryable and does not read to the user as a failed check.
    expect(fresh.kycStatus).toBe('EXPIRED');
    expect(fresh.kycVerifiedAt).toBeNull();
    expect(fresh.kycResetAt).not.toBeNull();
  });

  it('does not stop them investing — a re-check is not a freeze', async () => {
    const { agent, userId } = await investor('cantinvest@example.com');
    const staff = await admin('staff15@example.com');
    await act(staff.agent, userId, 'kyc-reset', { reason: 'Document expired' }).expect(200);

    const property = await prisma.property.create({
      data: {
        slug: 'reverify-tower',
        title: 'T',
        summary: 's',
        description: 'd',
        addressLine: 'a',
        area: 'Downtown Dubai',
        city: 'Dubai',
        images: [],
        totalValueCents: dollarsToCents('100000'),
        minInvestmentCents: dollarsToCents('1000'),
        annualReturnBps: 800,
        termMonths: 24,
        status: 'OPEN',
      },
    });

    // This asserted a 403 while identity verification gated investing. It no
    // longer does, and that is the right outcome here too: asking somebody to
    // re-verify is not a reason to stop them using money they already hold.
    // Staff who want to freeze an account have suspend, restrict and the
    // withdrawal block, all of which say so plainly to the investor.
    const res = await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: String(dollarsToCents('1000')) });
    expect(res.status).toBe(201);
  });

  /** Our decision must not spend the investor's own allowance. */
  it('does not consume their attempt allowance', async () => {
    const { userId } = await investor('allowance@example.com');
    const staff = await admin('staff16@example.com');

    // Burn the lifetime cap with historic attempts.
    for (let i = 0; i < 10; i += 1) {
      await prisma.kycVerification.create({
        data: {
          userId,
          provider: 'stub',
          status: 'REJECTED',
          submittedAt: new Date(Date.now() - (30 + i) * 86_400_000),
        },
      });
    }

    await act(staff.agent, userId, 'kyc-reset', { reason: 'Recheck required' }).expect(200);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const counted = await prisma.kycVerification.count({
      where: { userId, status: { not: 'EXPIRED' }, submittedAt: { gte: fresh.kycResetAt! } },
    });
    expect(counted).toBe(0);
  });

  it('refuses for somebody who never started', async () => {
    const { userId } = await signUp('neverstarted@example.com');
    const staff = await admin('staff17@example.com');
    await act(staff.agent, userId, 'kyc-reset', { reason: 'Recheck required' }).expect(400);
  });
});

// ── Money ────────────────────────────────────────────────────────────────────

describe('adjusting a balance', () => {
  it('credits, and writes a ledger entry the investor can read', async () => {
    const { userId } = await investor('credit@example.com', '1000');
    const staff = await admin('staff18@example.com');

    await act(staff.agent, userId, 'adjust-balance', {
      amountCents: '2500',
      reason: 'Goodwill credit for the failed transfer on 3 September',
    }).expect(200);

    expect(await balanceOf(userId)).toBe(dollarsToCents('1000') + 2_500n);

    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { type: 'ADJUSTMENT' } });
    expect(entry.amountCents).toBe(2_500n);
    expect(entry.description).toMatch(/Goodwill credit/);
  });

  it('claws back a locked bonus, clamping the lock instead of refusing', async () => {
    // The one debit that must ALWAYS work. Everywhere else a debit refuses to
    // reach into locked referral earnings; here it must, or a fraudulent bonus
    // becomes the single thing staff cannot reverse. The lock follows the money
    // down rather than blocking the write.
    const { userId } = await investor('clawback@example.com', '0');
    await prisma.wallet.update({
      where: { userId },
      data: { balanceCents: 2_000n, lockedCents: 2_000n },
    });
    const staff = await admin('staff-clawback@example.com');

    await act(staff.agent, userId, 'adjust-balance', {
      amountCents: '-1500',
      reason: 'Reversing a referral bonus paid on a cancelled investment',
    }).expect(200);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(wallet.balanceCents).toBe(500n);
    expect(wallet.lockedCents).toBe(500n);

    // One-way. The dollars the lock encumbered are gone, and re-locking a
    // balance somebody may have committed elsewhere is a conversation, not a
    // control.
    await act(staff.agent, userId, 'adjust-balance', {
      amountCents: '1500',
      reason: 'Putting back what was reversed in error, as agreed with support',
    }).expect(200);

    const after = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(after.balanceCents).toBe(2_000n);
    expect(after.lockedCents).toBe(500n);
  });

  it('debits', async () => {
    const { userId } = await investor('debit@example.com', '1000');
    const staff = await admin('staff19@example.com');

    await act(staff.agent, userId, 'adjust-balance', {
      amountCents: '-2500',
      reason: 'Reversing a deposit credited twice',
    }).expect(200);

    expect(await balanceOf(userId)).toBe(dollarsToCents('1000') - 2_500n);
  });

  /** Every screen and every sum assumes a balance cannot go negative. */
  it('refuses a debit larger than the balance, and writes nothing', async () => {
    const { userId } = await investor('overdraw@example.com', '10');
    const staff = await admin('staff20@example.com');

    const before = await balanceOf(userId);
    const res = await act(staff.agent, userId, 'adjust-balance', {
      amountCents: '-999999',
      reason: 'Reversing a deposit credited twice',
    });

    expect(res.status).toBe(422);
    expect(await balanceOf(userId)).toBe(before);
    expect(await prisma.ledgerEntry.count({ where: { type: 'ADJUSTMENT' } })).toBe(0);
    expect(await prisma.adminAction.count({ where: { type: 'ADJUST_BALANCE' } })).toBe(0);
  });

  it('keeps the wallet equal to the sum of its entries', async () => {
    const { userId } = await investor('balanced@example.com', '1000');
    const staff = await admin('staff21@example.com');
    await act(staff.agent, userId, 'adjust-balance', {
      amountCents: '4321',
      reason: 'Correcting an under-credited deposit',
    }).expect(200);

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId },
      include: { entries: true },
    });
    const sum = wallet.entries.reduce((acc, e) => acc + e.amountCents, 0n);
    expect(sum).toBe(wallet.balanceCents);
  });

  it('refuses zero', async () => {
    const { userId } = await investor('zero@example.com');
    const staff = await admin('staff22@example.com');
    await act(staff.agent, userId, 'adjust-balance', {
      amountCents: '0',
      reason: 'Nothing at all',
    }).expect(422);
  });

  it('tells the investor', async () => {
    const sent = vi.spyOn(emailService, 'sendBalanceAdjusted').mockResolvedValue();
    sent.mockClear();
    const { userId } = await investor('told@example.com', '1000');
    const staff = await admin('staff23@example.com');

    await act(staff.agent, userId, 'adjust-balance', {
      amountCents: '2500',
      reason: 'Goodwill credit',
    }).expect(200);

    expect(sent).toHaveBeenCalledOnce();
    expect(sent.mock.calls[0]![0]).toMatchObject({ to: 'told@example.com', credit: true });
  });
});

// ── Audit ────────────────────────────────────────────────────────────────────

describe('the audit trail', () => {
  it('records who did what, to whom, and why', async () => {
    const { userId } = await investor('audited@example.com');
    const staff = await admin('staff24@example.com');

    await setStatus(staff.agent, userId, 'restrict', 'Payment disputed by the bank').expect(200);

    const row = await prisma.adminAction.findFirstOrThrow({ where: { subjectId: userId } });
    expect(row.type).toBe('RESTRICT');
    expect(row.actorId).toBe(staff.userId);
    expect(row.reason).toBe('Payment disputed by the bank');
  });

  it('shows the history on the investor page', async () => {
    const { userId } = await investor('history@example.com');
    const staff = await admin('staff25@example.com');

    await setStatus(staff.agent, userId, 'restrict').expect(200);
    await setStatus(staff.agent, userId, 'unrestrict').expect(200);

    const res = await staff.agent.get(`/api/v1/admin/investors/${userId}`).expect(200);
    expect(res.body.investor.actions).toHaveLength(2);
    // Newest first.
    expect(res.body.investor.actions[0].type).toBe('UNRESTRICT');
    expect(res.body.investor.actions[0].actor.email).toBe('staff25@example.com');
  });

  it('insists on a reason worth recording', async () => {
    const { userId } = await investor('noreason@example.com');
    const staff = await admin('staff26@example.com');

    await setStatus(staff.agent, userId, 'suspend', '').expect(422);
    await setStatus(staff.agent, userId, 'suspend', 'x').expect(422);
  });
});

describe('access to the controls', () => {
  it('is refused to a non-admin', async () => {
    const { agent } = await investor('nosy@example.com');
    const victim = await investor('victim@example.com');

    for (const res of [
      await act(agent, victim.userId, 'status', { action: 'suspend', reason: REASON }),
      await act(agent, victim.userId, 'withdrawals', { action: 'block', reason: REASON }),
      await act(agent, victim.userId, 'kyc-reset', { reason: REASON }),
      await act(agent, victim.userId, 'adjust-balance', { amountCents: '9999', reason: REASON }),
      await act(agent, victim.userId, 'verify-email', { reason: REASON }),
    ]) {
      expect(res.status).toBe(403);
    }

    expect(await prisma.adminAction.count()).toBe(0);
  });
});

// ── Money already agreed ─────────────────────────────────────────────────────

describe('a suspended investor', () => {
  /** Their maturity is money already theirs. Withholding it is a dispute we lose. */
  it('still has their investment mature and credit', async () => {
    const { agent, userId } = await investor('matures@example.com');
    const staff = await admin('staff27@example.com');

    const property = await prisma.property.create({
      data: {
        slug: 'maturing-tower',
        title: 'T',
        summary: 's',
        description: 'd',
        addressLine: 'a',
        area: 'Downtown Dubai',
        city: 'Dubai',
        images: [],
        totalValueCents: dollarsToCents('100000'),
        minInvestmentCents: dollarsToCents('1000'),
        annualReturnBps: 800,
        termMonths: 24,
        status: 'OPEN',
      },
    });

    const res = await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: property.id, amountCents: String(dollarsToCents('10000')) })
      .expect(201);

    await prisma.investment.update({
      where: { id: res.body.investment.id },
      data: {
        investedAt: new Date(Date.now() - 731 * 86_400_000),
        maturesAt: new Date(Date.now() - 86_400_000),
      },
    });

    await setStatus(staff.agent, userId, 'suspend').expect(200);

    const before = await balanceOf(userId);
    // The sweep runs off the admin queue, which a suspended investor cannot reach.
    await staff.agent.get('/api/v1/admin/maturities').expect(200);

    expect(await balanceOf(userId)).toBeGreaterThan(before);
    const matured = await prisma.investment.findUniqueOrThrow({
      where: { id: res.body.investment.id },
    });
    expect(matured.status).toBe('MATURED');
  });
});
