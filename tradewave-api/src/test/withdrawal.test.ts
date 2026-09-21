import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { paymentProvider } from '../services/payments';
import { PAYOUT_ACCOUNT_HOLD_MS } from '../modules/wallet/withdrawal.service';
import { migrateTestDatabase, resetDatabase } from './helpers';

/**
 * Money leaving.
 *
 * The assertions that matter most here are the ones about where the dollars
 * ARE at each moment. A withdrawal that leaves money in a spendable balance,
 * or returns money that has already been sent, is worse than one that fails.
 */

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

  // The payout schedule defaults to Fridays, and these tests are about
  // everything EXCEPT the schedule. Switched off here so they do not pass or
  // fail depending on which day the suite is run — the schedule has its own
  // block at the bottom of this file, which turns it back on deliberately.
  await setSchedule({ enabled: false });
});

async function setSchedule(data: {
  enabled: boolean;
  daysOfWeek?: number[];
  opensAtMinute?: number;
  closesAtMinute?: number;
  timezone?: string;
}) {
  await prisma.withdrawalWindow.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
  });
}

async function createUser(email: string) {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ firstName: 'Joshua', lastName: 'Okoghie', email, password: PASSWORD, phone: '08030000000' });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/verify-email')
    .set('Origin', ORIGIN)
    .send({ token });
  return { agent, userId: res.body.user.id as string };
}

/** A verified investor with a funded wallet and a payout account past its hold. */
async function investor(
  email: string,
  options: {
    balanceCents?: bigint;
    withAccount?: boolean;
    accountAgeMs?: number;
    /** Leave them unverified, as most investors now are. */
    verified?: boolean;
    /** Referral earnings held pending verification. */
    lockedCents?: bigint;
  } = {},
) {
  const {
    balanceCents = 100_000n,
    withAccount = true,
    accountAgeMs = 48 * 60 * 60 * 1000,
    verified = true,
    lockedCents = 0n,
  } = options;

  const { agent, userId } = await createUser(email);
  if (verified) {
    await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: 'VERIFIED', kycVerifiedAt: new Date() },
    });
  }
  await prisma.wallet.create({ data: { userId, balanceCents, lockedCents } });

  if (withAccount) {
    await prisma.payoutAccount.create({
      data: {
        userId,
        bankCode: '044',
        bankName: 'Access Bank',
        accountNumber: '0690000032',
        accountName: 'OKOGHIE JOSHUA',
        nameResolved: true,
        destinationChangedAt: new Date(Date.now() - accountAgeMs),
      },
    });
  }

  return { agent, userId };
}

async function admin(email: string) {
  const { agent, userId } = await createUser(email);
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
  return { agent, userId };
}

/** ₦1,650/$ — the figure the deposit tests use. */
async function setRate(koboPerUsd = 165_000n) {
  await prisma.fxRate.create({
    data: { baseCurrency: 'USD', quoteCurrency: 'NGN', minorPerUnit: koboPerUsd },
  });
}

const withdraw = (agent: ReturnType<typeof request.agent>, amountCents: string) =>
  agent.post('/api/v1/wallet/withdrawals').set('Origin', ORIGIN).send({ amountCents });

async function balanceOf(userId: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return wallet.balanceCents;
}

// ── Asking ───────────────────────────────────────────────────────────────────

describe('requesting a withdrawal', () => {
  it('refuses below the minimum, and allows exactly the minimum', async () => {
    const { agent } = await investor('min@example.com');

    const low = await withdraw(agent, '999');
    expect(low.status).toBe(422);
    expect(low.body.error.code).toBe('BELOW_MINIMUM_WITHDRAWAL');

    await withdraw(agent, '1000').expect(201);
  });

  it('refuses when there is nowhere to send the money', async () => {
    const { agent } = await investor('noaccount@example.com', { withAccount: false });
    const res = await withdraw(agent, '5000');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_PAYOUT_ACCOUNT');
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it('pays an unverified investor their own money', async () => {
    // This was a 403 KYC_REQUIRED. It is their money; holding it hostage to a
    // document check is the frustration this whole change removes.
    const { agent } = await investor('unverified@example.com', { verified: false });
    const res = await withdraw(agent, '5000');
    expect(res.status).toBe(201);
  });

  it('will not let an unverified investor withdraw a locked referral bonus', async () => {
    // $250 deposited plus a $20 bonus earned before verifying. The whole $270
    // shows in the balance; only $250 may leave.
    const { agent, userId } = await investor('mixed@example.com', {
      verified: false,
      balanceCents: 27_000n,
      lockedCents: 2_000n,
    });

    const overreach = await withdraw(agent, '26000');
    expect(overreach.status).toBe(422);
    expect(overreach.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(overreach.body.error.message).toMatch(/referral/i);
    expect(await prisma.withdrawal.count()).toBe(0);

    const allowed = await withdraw(agent, '25000');
    expect(allowed.status).toBe(201);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(wallet.balanceCents).toBe(2_000n);
    expect(wallet.lockedCents).toBe(2_000n);
  });

  it('frees that bonus the moment the identity check passes', async () => {
    const { agent, userId } = await investor('unlocks@example.com', {
      verified: false,
      balanceCents: 2_000n,
      lockedCents: 2_000n,
    });

    // Refused while the lock binds...
    expect((await withdraw(agent, '2000')).status).toBe(422);

    // ...and allowed once it does not. The lock is advisory: the guard reads it
    // through the User row, so verification alone is enough even before the
    // column is zeroed. That is what stops a bonus credited in the same instant
    // as a decision being stranded forever.
    await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: 'VERIFIED', kycVerifiedAt: new Date() },
    });
    expect((await withdraw(agent, '2000')).status).toBe(201);
  });

  // The destination is what an attacker changes. The change already emails the
  // real owner; the hold is what turns that email into something they can act on.
  it('holds a withdrawal for 24 hours after the payout account changes', async () => {
    const { agent } = await investor('fresh@example.com', { accountAgeMs: 60 * 60 * 1000 });
    const res = await withdraw(agent, '5000');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PAYOUT_ACCOUNT_TOO_NEW');
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it('allows it once the hold has lifted', async () => {
    const { agent } = await investor('aged@example.com', {
      accountAgeMs: PAYOUT_ACCOUNT_HOLD_MS + 60_000,
    });
    await withdraw(agent, '5000').expect(201);
  });

  /**
   * Re-saving the SAME account must not restart the clock. Otherwise the hold
   * fires on a no-op, reads as arbitrary, and the first thing users learn is to
   * work around it.
   */
  it('does not restart the hold when the same account is saved again', async () => {
    const { agent, userId } = await investor('resave@example.com');
    const before = await prisma.payoutAccount.findUniqueOrThrow({ where: { userId } });

    await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send({ bankCode: '044', accountNumber: '0690000032', accountName: 'OKOGHIE JOSHUA' })
      .expect(200);

    const after = await prisma.payoutAccount.findUniqueOrThrow({ where: { userId } });
    expect(after.destinationChangedAt.getTime()).toBe(before.destinationChangedAt.getTime());
    await withdraw(agent, '5000').expect(201);
  });

  it('DOES restart the hold when the destination actually moves', async () => {
    const { agent, userId } = await investor('moved@example.com');

    await agent
      .put('/api/v1/wallet/payout-account')
      .set('Origin', ORIGIN)
      .send({ bankCode: '058', accountNumber: '0690000099', accountName: 'OKOGHIE JOSHUA' })
      .expect(200);

    const after = await prisma.payoutAccount.findUniqueOrThrow({ where: { userId } });
    expect(Date.now() - after.destinationChangedAt.getTime()).toBeLessThan(5_000);

    const res = await withdraw(agent, '5000');
    expect(res.body.error.code).toBe('PAYOUT_ACCOUNT_TOO_NEW');
  });

  it('refuses more than the balance, and writes nothing at all', async () => {
    const { agent, userId } = await investor('broke@example.com', { balanceCents: 4_000n });

    const res = await withdraw(agent, '5000');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');

    expect(await prisma.withdrawal.count()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(0);
    expect(await balanceOf(userId)).toBe(4_000n);
  });

  // The dollars leave NOW, not when the money is sent. A pending balance the
  // investor can still spend is the bug that lets the same dollars be
  // withdrawn and invested at once.
  it('takes the money out of the wallet immediately, with a negative ledger entry', async () => {
    const { agent, userId } = await investor('debit@example.com', { balanceCents: 100_000n });

    const res = await withdraw(agent, '25000').expect(201);
    expect(res.body.withdrawal.status).toBe('REQUESTED');
    expect(res.body.withdrawal.netCents).toBe('24900'); // $250 less the $1 fee

    expect(await balanceOf(userId)).toBe(75_000n);

    const entries = await prisma.ledgerEntry.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe('WITHDRAWAL');
    expect(entries[0]!.amountCents).toBe(-25_000n);
    expect(entries[0]!.balanceAfterCents).toBe(75_000n);
    expect(entries[0]!.reference).toBe(`wdr_${res.body.withdrawal.id}`);
  });

  it('snapshots the destination, so later edits cannot rewrite history', async () => {
    const { agent, userId } = await investor('snapshot@example.com');
    const res = await withdraw(agent, '5000').expect(201);

    await prisma.payoutAccount.update({
      where: { userId },
      data: { bankName: 'Zenith Bank', accountNumber: '1111111111' },
    });

    const row = await prisma.withdrawal.findUniqueOrThrow({
      where: { id: res.body.withdrawal.id },
    });
    expect(row.bankName).toBe('Access Bank');
    expect(row.accountNumber).toBe('0690000032');
  });

  it('allows only one withdrawal in flight at a time', async () => {
    const { agent } = await investor('queue@example.com');
    await withdraw(agent, '5000').expect(201);

    const second = await withdraw(agent, '5000');
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('WITHDRAWAL_PENDING');
  });

  /**
   * The balance guard is the one that actually has to hold under concurrency:
   * the condition lives in the WHERE clause, so Postgres arbitrates and the
   * loser matches zero rows.
   */
  it('cannot be raced into an overdraft', async () => {
    const { agent, userId } = await investor('race@example.com', { balanceCents: 6_000n });

    const results = await Promise.allSettled([
      withdraw(agent, '5000'),
      withdraw(agent, '5000'),
    ]);
    const created = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 201,
    );
    expect(created).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(1_000n);
  });

  it('cannot be raced into spending locked money either', async () => {
    // The guard moved from a Prisma `where` into raw SQL when it had to compare
    // across two columns and a joined row. A lost race stopped throwing P2025
    // and started returning zero rows, so this is the test that proves the
    // guard survived the conversion rather than quietly becoming advisory.
    const { agent, userId } = await investor('lockedrace@example.com', {
      verified: false,
      balanceCents: 12_000n,
      lockedCents: 6_000n,
    });

    const results = await Promise.allSettled([
      withdraw(agent, '6000'),
      withdraw(agent, '6000'),
    ]);
    const created = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 201,
    );
    expect(created).toHaveLength(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(wallet.balanceCents).toBe(6_000n);
    expect(wallet.lockedCents).toBe(6_000n);
  });

  it('never leaves the balance negative', async () => {
    const { agent, userId } = await investor('floor@example.com', { balanceCents: 10_000n });
    await withdraw(agent, '10000').expect(201);
    expect(await balanceOf(userId)).toBe(0n);
  });

  it('tells the investor money is leaving', async () => {
    const sent = vi.spyOn(emailService, 'sendWithdrawalRequested').mockResolvedValue();
    const { agent } = await investor('notified@example.com');
    await withdraw(agent, '5000').expect(201);
    expect(sent).toHaveBeenCalledOnce();
    expect(sent.mock.calls[0]![0]).toMatchObject({ to: 'notified@example.com' });
  });
});

// ── Cancelling ───────────────────────────────────────────────────────────────

describe('cancelling', () => {
  it('returns the money and leaves a matching credit', async () => {
    const { agent, userId } = await investor('cancel@example.com', { balanceCents: 50_000n });
    const res = await withdraw(agent, '20000').expect(201);
    expect(await balanceOf(userId)).toBe(30_000n);

    await agent
      .post(`/api/v1/wallet/withdrawals/${res.body.withdrawal.id}/cancel`)
      .set('Origin', ORIGIN)
      .expect(200);

    expect(await balanceOf(userId)).toBe(50_000n);
    const entries = await prisma.ledgerEntry.findMany({ orderBy: { createdAt: 'asc' } });
    expect(entries).toHaveLength(2);
    expect(entries[1]!.amountCents).toBe(20_000n);
    expect(entries[1]!.balanceAfterCents).toBe(50_000n);
  });

  it('frees the investor to request again', async () => {
    const { agent } = await investor('again@example.com');
    const res = await withdraw(agent, '5000').expect(201);
    await agent
      .post(`/api/v1/wallet/withdrawals/${res.body.withdrawal.id}/cancel`)
      .set('Origin', ORIGIN)
      .expect(200);
    await withdraw(agent, '5000').expect(201);
  });

  it('refuses to cancel somebody else’s withdrawal', async () => {
    const { agent } = await investor('mine@example.com');
    const other = await investor('theirs@example.com');
    const res = await withdraw(other.agent, '5000').expect(201);

    await agent
      .post(`/api/v1/wallet/withdrawals/${res.body.withdrawal.id}/cancel`)
      .set('Origin', ORIGIN)
      .expect(404);
  });
});

// ── Releasing ────────────────────────────────────────────────────────────────

describe('approving', () => {
  it('needs an admin', async () => {
    const { agent } = await investor('notadmin@example.com');
    const res = await withdraw(agent, '5000').expect(201);
    await agent
      .post(`/api/v1/admin/withdrawals/${res.body.withdrawal.id}/approve`)
      .set('Origin', ORIGIN)
      .expect(403);
  });

  /**
   * Fail closed with no rate, exactly as a deposit does. There is no defensible
   * naira figure to send, and guessing one moves real money.
   */
  it('refuses to send when no FX rate is set, and changes nothing', async () => {
    const { agent } = await investor('norate@example.com');
    const staff = await admin('staff1@example.com');
    const sendPayout = vi.spyOn(paymentProvider, 'sendPayout');

    const res = await withdraw(agent, '5000').expect(201);
    const approve = await staff.agent
      .post(`/api/v1/admin/withdrawals/${res.body.withdrawal.id}/approve`)
      .set('Origin', ORIGIN);

    expect(approve.status).toBe(503);
    expect(approve.body.error.code).toBe('WITHDRAWALS_UNAVAILABLE');
    expect(sendPayout).not.toHaveBeenCalled();

    const row = await prisma.withdrawal.findUniqueOrThrow({
      where: { id: res.body.withdrawal.id },
    });
    expect(row.status).toBe('REQUESTED');
  });

  it('pins the rate and sends the net amount in whole naira', async () => {
    await setRate(165_000n);
    const { agent } = await investor('send@example.com');
    const staff = await admin('staff2@example.com');
    const sendPayout = vi.spyOn(paymentProvider, 'sendPayout');

    // $100.00 requested, $1.00 fee, so $99.00 converts at ₦1,650/$ = ₦163,350.
    const res = await withdraw(agent, '10000').expect(201);
    await staff.agent
      .post(`/api/v1/admin/withdrawals/${res.body.withdrawal.id}/approve`)
      .set('Origin', ORIGIN)
      .expect(200);

    expect(sendPayout).toHaveBeenCalledOnce();
    expect(sendPayout.mock.calls[0]![0]).toMatchObject({
      amountMinor: 16_335_000n,
      currency: 'NGN',
      country: 'NG',
      bankCode: '044',
      accountNumber: '0690000032',
    });

    const row = await prisma.withdrawal.findUniqueOrThrow({
      where: { id: res.body.withdrawal.id },
    });
    expect(row.status).toBe('APPROVED');
    expect(row.destinationAmountMinor).toBe(16_335_000n);
    expect(row.rateMinorPerUnit).toBe(165_000n);
    // Whole naira: Klasha's amount field takes naira, not kobo.
    expect(row.destinationAmountMinor! % 100n).toBe(0n);
  });

  it('returns the money when the provider refuses', async () => {
    await setRate();
    const { agent, userId } = await investor('refused@example.com', { balanceCents: 50_000n });
    const staff = await admin('staff3@example.com');
    vi.spyOn(paymentProvider, 'sendPayout').mockResolvedValue({
      state: 'refused',
      reason: 'Insufficient wallet balance',
    });

    const res = await withdraw(agent, '20000').expect(201);
    expect(await balanceOf(userId)).toBe(30_000n);

    await staff.agent
      .post(`/api/v1/admin/withdrawals/${res.body.withdrawal.id}/approve`)
      .set('Origin', ORIGIN)
      .expect(200);

    const row = await prisma.withdrawal.findUniqueOrThrow({
      where: { id: res.body.withdrawal.id },
    });
    expect(row.status).toBe('FAILED');
    expect(row.failureReason).toBe('Insufficient wallet balance');
    expect(await balanceOf(userId)).toBe(50_000n);
  });

  /**
   * THE double-pay guard.
   *
   * A thrown call is not evidence the money stayed put. Crediting the wallet
   * back here would let an investor spend dollars that may already be on their
   * way to a bank account.
   */
  it('leaves the money OUT when the provider call fails with an unknown outcome', async () => {
    await setRate();
    const { agent, userId } = await investor('unknown@example.com', { balanceCents: 50_000n });
    const staff = await admin('staff4@example.com');
    vi.spyOn(paymentProvider, 'sendPayout').mockRejectedValue(new Error('socket hang up'));

    const res = await withdraw(agent, '20000').expect(201);
    const approve = await staff.agent
      .post(`/api/v1/admin/withdrawals/${res.body.withdrawal.id}/approve`)
      .set('Origin', ORIGIN);

    expect(approve.status).toBe(503);

    const row = await prisma.withdrawal.findUniqueOrThrow({
      where: { id: res.body.withdrawal.id },
    });
    expect(row.status).toBe('APPROVED');
    expect(await balanceOf(userId)).toBe(30_000n);
    expect(await prisma.ledgerEntry.count()).toBe(1);
  });

  it('cannot be approved twice', async () => {
    await setRate();
    const { agent } = await investor('twice@example.com');
    const staff = await admin('staff5@example.com');
    const sendPayout = vi.spyOn(paymentProvider, 'sendPayout');

    const res = await withdraw(agent, '5000').expect(201);
    const url = `/api/v1/admin/withdrawals/${res.body.withdrawal.id}/approve`;

    await staff.agent.post(url).set('Origin', ORIGIN).expect(200);
    const second = await staff.agent.post(url).set('Origin', ORIGIN);

    expect(second.status).toBe(400);
    expect(sendPayout).toHaveBeenCalledOnce();
  });
});

describe('rejecting', () => {
  it('returns the money and records the reason the investor is told', async () => {
    const { agent, userId } = await investor('rejected@example.com', { balanceCents: 40_000n });
    const staff = await admin('staff6@example.com');
    const settled = vi.spyOn(emailService, 'sendWithdrawalSettled').mockResolvedValue();

    const res = await withdraw(agent, '15000').expect(201);
    await staff.agent
      .post(`/api/v1/admin/withdrawals/${res.body.withdrawal.id}/reject`)
      .set('Origin', ORIGIN)
      .send({ reason: 'Account name does not match your identity' })
      .expect(200);

    const row = await prisma.withdrawal.findUniqueOrThrow({
      where: { id: res.body.withdrawal.id },
    });
    expect(row.status).toBe('REJECTED');
    expect(row.rejectionReason).toBe('Account name does not match your identity');
    expect(await balanceOf(userId)).toBe(40_000n);
    expect(settled.mock.calls[0]![0]).toMatchObject({ paid: false });
  });

  it('insists on a reason', async () => {
    const { agent } = await investor('noreason@example.com');
    const staff = await admin('staff7@example.com');
    const res = await withdraw(agent, '5000').expect(201);

    await staff.agent
      .post(`/api/v1/admin/withdrawals/${res.body.withdrawal.id}/reject`)
      .set('Origin', ORIGIN)
      .send({ reason: '' })
      .expect(422);
  });
});

// ── Settling ─────────────────────────────────────────────────────────────────

describe('settling', () => {
  async function approved(email: string) {
    await setRate();
    const { agent, userId } = await investor(email, { balanceCents: 50_000n });
    const staff = await admin(`admin-${email}`);
    vi.spyOn(paymentProvider, 'sendPayout').mockResolvedValue({
      state: 'sent',
      providerRef: 'kbtr-123',
    });
    const res = await withdraw(agent, '20000').expect(201);
    await staff.agent
      .post(`/api/v1/admin/withdrawals/${res.body.withdrawal.id}/approve`)
      .set('Origin', ORIGIN)
      .expect(200);
    return { agent, userId, staff, id: res.body.withdrawal.id as string };
  }

  it('marks it paid on a successful payout webhook', async () => {
    const { id } = await approved('paid@example.com');

    await request(app)
      .post('/api/v1/wallet/deposits/webhook')
      .send({ event: 'payout', data: { reference: 'kbtr-123', status: 'successful' } })
      .expect(200);

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('PAID');
    expect(row.paidAt).not.toBeNull();
  });

  it('returns the money on a failed payout webhook', async () => {
    const { id, userId } = await approved('failedhook@example.com');

    await request(app)
      .post('/api/v1/wallet/deposits/webhook')
      .send({ event: 'payout', data: { reference: 'kbtr-123', status: 'failed' } })
      .expect(200);

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('FAILED');
    expect(await balanceOf(userId)).toBe(50_000n);
  });

  /**
   * The sharpest risk in the whole feature: one webhook URL receives both money
   * arriving and money leaving, and a payout must never be able to credit a
   * wallet.
   */
  it('a payout webhook can never credit a wallet', async () => {
    const { userId } = await approved('nocredit@example.com');
    const before = await balanceOf(userId);
    const getPayment = vi.spyOn(paymentProvider, 'getPayment');

    await request(app)
      .post('/api/v1/wallet/deposits/webhook')
      .send({
        event: 'payout',
        data: { reference: 'kbtr-123', tnxRef: 'kbtr-123', status: 'successful' },
      })
      .expect(200);

    expect(getPayment).not.toHaveBeenCalled();
    expect(await balanceOf(userId)).toBe(before);
  });

  it('ignores a payout webhook for a reference it does not know', async () => {
    const { id } = await approved('unknownref@example.com');

    await request(app)
      .post('/api/v1/wallet/deposits/webhook')
      .send({ event: 'payout', data: { reference: 'kbtr-nope', status: 'failed' } })
      .expect(200);

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('APPROVED');
  });

  it('is idempotent — a replayed webhook does not pay or credit twice', async () => {
    const { id, userId } = await approved('replay@example.com');
    const body = { event: 'payout', data: { reference: 'kbtr-123', status: 'successful' } };

    await request(app).post('/api/v1/wallet/deposits/webhook').send(body).expect(200);
    await request(app).post('/api/v1/wallet/deposits/webhook').send(body).expect(200);

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('PAID');
    expect(await balanceOf(userId)).toBe(30_000n);
    expect(await prisma.ledgerEntry.count()).toBe(1);
  });

  it('settles from the sweep when the webhook never arrives', async () => {
    const { id, staff, userId } = await approved('swept@example.com');
    vi.spyOn(paymentProvider, 'getPayout').mockResolvedValue({
      state: 'failed',
      providerRef: 'kbtr-123',
      reason: 'Account closed',
    });

    // The sweep runs off the admin queue read.
    await staff.agent.get('/api/v1/admin/withdrawals').expect(200);

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('FAILED');
    expect(row.failureReason).toBe('Account closed');
    expect(await balanceOf(userId)).toBe(50_000n);
  });

  // Null means "the provider could not tell us", which is not evidence of
  // anything. Leaving the row alone is the only safe reading.
  it('leaves a withdrawal alone when the provider cannot report on it', async () => {
    const { id, staff } = await approved('noanswer@example.com');
    vi.spyOn(paymentProvider, 'getPayout').mockResolvedValue(null);

    await staff.agent.get('/api/v1/admin/withdrawals').expect(200);

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('APPROVED');
  });

  it('can be marked paid by hand when the provider is unusable', async () => {
    const { id, staff } = await approved('manual@example.com');

    await staff.agent
      .post(`/api/v1/admin/withdrawals/${id}/mark-paid`)
      .set('Origin', ORIGIN)
      .send({ note: 'Paid from the GTB app' })
      .expect(200);

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('PAID');
    expect(row.provider).toBe('manual');
  });

  /**
   * A FAILED withdrawal has already had its money returned. Marking it paid
   * would send money the investor can also still spend.
   */
  it('refuses to mark a FAILED withdrawal as paid', async () => {
    const { id, staff } = await approved('failedmanual@example.com');
    await prisma.withdrawal.update({ where: { id }, data: { status: 'FAILED' } });

    const res = await staff.agent
      .post(`/api/v1/admin/withdrawals/${id}/mark-paid`)
      .set('Origin', ORIGIN)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/request it again/i);
  });
});

// ── Reading ──────────────────────────────────────────────────────────────────

describe('the withdrawal screen', () => {
  it('reports the limits, the destination and the live request in one read', async () => {
    await setRate(165_000n);
    const { agent } = await investor('context@example.com', { balanceCents: 70_000n });

    const before = await agent.get('/api/v1/wallet/withdrawals').expect(200);
    expect(before.body).toMatchObject({
      minimumCents: '1000',
      feeCents: '100',
      balanceCents: '70000',
      rateMinorPerUnit: '165000',
      live: null,
    });
    expect(before.body.payoutAccount.accountNumberMasked).toBe('••••0032');
    expect(before.body.payoutAccount).not.toHaveProperty('accountNumber');

    await withdraw(agent, '20000').expect(201);
    const after = await agent.get('/api/v1/wallet/withdrawals').expect(200);
    expect(after.body.live.status).toBe('REQUESTED');
    expect(after.body.balanceCents).toBe('50000');
    expect(after.body.history).toHaveLength(1);
  });

  it('reports the hold while it is running', async () => {
    const { agent } = await investor('held@example.com', { accountAgeMs: 60 * 60 * 1000 });
    const res = await agent.get('/api/v1/wallet/withdrawals').expect(200);
    expect(res.body.holdUntil).not.toBeNull();
  });

  it('never exposes a full account number to staff either', async () => {
    const { agent } = await investor('maskadmin@example.com');
    const staff = await admin('staff8@example.com');
    await withdraw(agent, '5000').expect(201);

    const res = await staff.agent.get('/api/v1/admin/withdrawals').expect(200);
    expect(res.body.withdrawals[0].accountNumberMasked).toBe('••••0032');
    expect(JSON.stringify(res.body)).not.toContain('0690000032');
  });

  it('flags a destination that changed recently, which is what a reviewer is for', async () => {
    const { agent } = await investor('flagged@example.com', {
      accountAgeMs: PAYOUT_ACCOUNT_HOLD_MS + 60_000,
    });
    const staff = await admin('staff9@example.com');
    await withdraw(agent, '5000').expect(201);

    const res = await staff.agent.get('/api/v1/admin/withdrawals').expect(200);
    expect(res.body.withdrawals[0].destinationChangedRecently).toBe(true);
  });
});

// ── The payout schedule ──────────────────────────────────────────────────────

/**
 * Asking is gated, not just paying.
 *
 * A balance that drops on Tuesday for money that arrives on Friday is
 * indistinguishable, from where the investor sits, from not being paid at all.
 * These assert that the door is genuinely shut, and that it says when it opens.
 */
describe('the payout schedule', () => {
  /** Days of the week, as the window stores them: 0 = Sunday. */
  const today = () => new Date().getDay();
  const tomorrow = () => (today() + 1) % 7;

  it('refuses a request on a day that is not a payout day', async () => {
    const { agent } = await investor('closed@example.com');
    await setSchedule({ enabled: true, daysOfWeek: [tomorrow()] });

    const res = await withdraw(agent, '5000');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WITHDRAWALS_CLOSED');
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it('allows a request on a payout day, inside the hours', async () => {
    const { agent } = await investor('open@example.com');
    // All day today, so the test does not depend on the clock.
    await setSchedule({
      enabled: true,
      daysOfWeek: [today()],
      opensAtMinute: 0,
      closesAtMinute: 1_440,
    });

    await withdraw(agent, '5000').expect(201);
  });

  it('refuses outside the hours, even on a payout day', async () => {
    const { agent } = await investor('afterhours@example.com');
    // A window that has already closed, whatever time it is now.
    await setSchedule({
      enabled: true,
      daysOfWeek: [today()],
      opensAtMinute: 0,
      closesAtMinute: 1,
    });

    const res = await withdraw(agent, '5000');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WITHDRAWALS_CLOSED');
  });

  it('tells the investor when it next opens, rather than just saying no', async () => {
    const { agent } = await investor('countdown@example.com');
    await setSchedule({ enabled: true, daysOfWeek: [tomorrow()] });

    const context = await agent.get('/api/v1/wallet/withdrawals').expect(200);
    expect(context.body.window.open).toBe(false);
    expect(context.body.window.opensAt).not.toBeNull();
    expect(new Date(context.body.window.opensAt).getTime()).toBeGreaterThan(Date.now());
    expect(context.body.window.schedule).toMatch(/\d{2}:\d{2}/);
  });

  /**
   * The asymmetry that makes the whole thing workable: a request made ten
   * minutes before closing still has to be finishable, and a provider outage on
   * payout day has to be catchable the next morning.
   */
  it('does NOT stop staff approving once the window has closed', async () => {
    await setRate();
    const { agent } = await investor('latefriday@example.com');
    const staff = await admin('staff-window@example.com');

    await setSchedule({
      enabled: true,
      daysOfWeek: [today()],
      opensAtMinute: 0,
      closesAtMinute: 1_440,
    });
    const res = await withdraw(agent, '5000').expect(201);

    // The door shuts behind them.
    await setSchedule({ enabled: true, daysOfWeek: [tomorrow()] });

    await staff.agent
      .post(`/api/v1/admin/withdrawals/${res.body.withdrawal.id}/approve`)
      .set('Origin', ORIGIN)
      .expect(200);
  });

  it('can be switched off entirely, and then accepts requests any day', async () => {
    const { agent } = await investor('always@example.com');
    await setSchedule({ enabled: false, daysOfWeek: [tomorrow()] });
    await withdraw(agent, '5000').expect(201);
  });

  it('lets an admin change the schedule, and refuses a nonsense one', async () => {
    const staff = await admin('staff-setwindow@example.com');

    const ok = await staff.agent
      .post('/api/v1/admin/withdrawal-window')
      .set('Origin', ORIGIN)
      .send({
        enabled: true,
        daysOfWeek: [1, 5],
        opensAtMinute: 540,
        closesAtMinute: 1_020,
        timezone: 'Africa/Lagos',
      })
      .expect(200);
    expect(ok.body.window.daysOfWeek).toEqual([1, 5]);

    // Closing before it opens.
    await staff.agent
      .post('/api/v1/admin/withdrawal-window')
      .set('Origin', ORIGIN)
      .send({
        enabled: true,
        daysOfWeek: [5],
        opensAtMinute: 1_020,
        closesAtMinute: 540,
        timezone: 'Africa/Lagos',
      })
      .expect(400);

    // On, with no days — a schedule that can never open.
    await staff.agent
      .post('/api/v1/admin/withdrawal-window')
      .set('Origin', ORIGIN)
      .send({
        enabled: true,
        daysOfWeek: [],
        opensAtMinute: 540,
        closesAtMinute: 1_020,
        timezone: 'Africa/Lagos',
      })
      .expect(400);

    // A timezone this server has never heard of.
    await staff.agent
      .post('/api/v1/admin/withdrawal-window')
      .set('Origin', ORIGIN)
      .send({
        enabled: true,
        daysOfWeek: [5],
        opensAtMinute: 540,
        closesAtMinute: 1_020,
        timezone: 'Mars/Olympus_Mons',
      })
      .expect(400);
  });

  it('is not something an investor can change', async () => {
    const { agent } = await investor('nosetwindow@example.com');
    await agent
      .post('/api/v1/admin/withdrawal-window')
      .set('Origin', ORIGIN)
      .send({
        enabled: false,
        daysOfWeek: [5],
        opensAtMinute: 540,
        closesAtMinute: 1_020,
        timezone: 'Africa/Lagos',
      })
      .expect(403);
  });
});
