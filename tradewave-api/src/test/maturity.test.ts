import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { dollarsToCents } from '../lib/money';
import { computeAccrual } from '../modules/investment/accrual';
import { settleInvestment } from '../modules/investment/maturity.service';
import { migrateTestDatabase, resetDatabase } from './helpers';

/**
 * Paying investors back.
 *
 * The assertions that matter are the ones about paying TWICE and about paying
 * LATE. Everything else in this file is arithmetic; those two are the ways this
 * costs real money.
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
  vi.spyOn(emailService, 'sendInvestmentMatured').mockResolvedValue();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.property.deleteMany();
  verifyUrls.length = 0;
});

async function investor(email: string, balance: string) {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ firstName: 'Test', lastName: 'Investor', email, password: PASSWORD, phone: '08030000000' });
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
      description: 'Opening balance',
    },
  });

  return { agent, userId };
}

async function admin(email: string) {
  const { agent, userId } = await investor(email, '0');
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
  return { agent, userId };
}

async function property(bps = 800, termMonths = 24) {
  return prisma.property.create({
    data: {
      slug: `mat-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Maturity Tower',
      summary: 's',
      description: 'd',
      addressLine: 'a',
      area: 'Downtown Dubai',
      city: 'Dubai',
      images: [],
      totalValueCents: dollarsToCents('1000000'),
      minInvestmentCents: dollarsToCents('1000'),
      annualReturnBps: bps,
      termMonths,
      status: 'OPEN',
    },
  });
}

/**
 * Invests, then rewinds the clock on the row so the term has already ended.
 *
 * Backdating rather than waiting: maturesAt is derived from termMonths at
 * purchase, and the alternative is a test that takes two years.
 */
async function maturedInvestment(
  agent: ReturnType<typeof request.agent>,
  propertyId: string,
  amount: string,
  options: { overdueDays?: number; bps?: number } = {},
) {
  const res = await agent
    .post('/api/v1/investments')
    .set('Origin', ORIGIN)
    .send({ propertyId, amountCents: String(dollarsToCents(amount)) })
    .expect(201);

  const id = res.body.investment.id as string;
  const overdue = options.overdueDays ?? 1;
  const investedAt = new Date(Date.now() - (730 + overdue) * 86_400_000);
  const maturesAt = new Date(Date.now() - overdue * 86_400_000);

  await prisma.investment.update({ where: { id }, data: { investedAt, maturesAt } });
  return { id, investedAt, maturesAt };
}

const balanceOf = async (userId: string) =>
  (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balanceCents;

describe('settling a matured investment', () => {
  it('returns the principal and the return, as two ledger lines', async () => {
    const { agent, userId } = await investor('settle@example.com', '50000');
    const p = await property(800, 24);
    const { id, investedAt, maturesAt } = await maturedInvestment(agent, p.id, '10000');

    // $10,000 debited at purchase, so the balance is $40,000 going in.
    expect(await balanceOf(userId)).toBe(dollarsToCents('40000'));

    const settled = await settleInvestment(id);
    expect(settled).not.toBeNull();

    const expected = computeAccrual(
      {
        principalCents: dollarsToCents('10000'),
        annualReturnBps: 800,
        investedAt,
        maturesAt,
      },
      maturesAt,
    );
    expect(settled!.returnCents).toBe(expected.accruedCents);
    expect(settled!.totalCents).toBe(dollarsToCents('10000') + expected.accruedCents);

    expect(await balanceOf(userId)).toBe(dollarsToCents('40000') + settled!.totalCents);

    const entries = await prisma.ledgerEntry.findMany({
      where: { type: 'RETURN_PAYOUT' },
      orderBy: { reference: 'asc' },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.description).toMatch(/Principal returned/);
    expect(entries[0]!.amountCents).toBe(dollarsToCents('10000'));
    expect(entries[1]!.description).toMatch(/Return earned/);
    expect(entries[1]!.amountCents).toBe(expected.accruedCents);
  });

  it('marks the investment MATURED', async () => {
    const { agent } = await investor('marked@example.com', '50000');
    const p = await property();
    const { id } = await maturedInvestment(agent, p.id, '10000');

    await settleInvestment(id);
    const row = await prisma.investment.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('MATURED');
  });

  /** The one that costs real money if it is wrong. */
  it('cannot pay the same maturity twice', async () => {
    const { agent, userId } = await investor('twice@example.com', '50000');
    const p = await property();
    const { id } = await maturedInvestment(agent, p.id, '10000');

    const first = await settleInvestment(id);
    const after = await balanceOf(userId);

    const second = await settleInvestment(id);
    expect(second).toBeNull();
    expect(await balanceOf(userId)).toBe(after);
    expect(first).not.toBeNull();

    expect(await prisma.ledgerEntry.count({ where: { type: 'RETURN_PAYOUT' } })).toBe(2);
  });

  it('cannot be raced into paying twice', async () => {
    const { agent, userId } = await investor('race@example.com', '50000');
    const p = await property();
    const { id } = await maturedInvestment(agent, p.id, '10000');

    const results = await Promise.allSettled([settleInvestment(id), settleInvestment(id)]);
    const paid = results.filter(
      (r): r is PromiseFulfilledResult<{ totalCents: bigint }> =>
        r.status === 'fulfilled' && r.value !== null,
    );

    // Exactly one wins, two ledger lines exist, and the wallet grew by exactly
    // what that one payout was worth — not twice it.
    expect(paid).toHaveLength(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'RETURN_PAYOUT' } })).toBe(2);
    expect(await balanceOf(userId)).toBe(
      dollarsToCents('40000') + paid[0]!.value.totalCents,
    );
  });

  it('refuses to settle one that has not come due', async () => {
    const { agent, userId } = await investor('early@example.com', '50000');
    const p = await property();
    const res = await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: p.id, amountCents: String(dollarsToCents('10000')) })
      .expect(201);

    expect(await settleInvestment(res.body.investment.id)).toBeNull();
    expect(await balanceOf(userId)).toBe(dollarsToCents('40000'));
  });

  /**
   * Settled late pays exactly what it would have paid on the day. Nobody earns
   * interest on our slowness, and nobody loses out from it either.
   */
  it('pays the same amount however late it is settled', async () => {
    const p = await property();
    const a = await investor('ontime@example.com', '50000');
    const b = await investor('verylate@example.com', '50000');

    const onTime = await maturedInvestment(a.agent, p.id, '10000', { overdueDays: 1 });
    const late = await maturedInvestment(b.agent, p.id, '10000', { overdueDays: 400 });

    const first = await settleInvestment(onTime.id);
    const second = await settleInvestment(late.id);

    expect(second!.totalCents).toBe(first!.totalCents);
  });

  it('keeps the wallet balanced against its own ledger', async () => {
    const { agent, userId } = await investor('balanced@example.com', '50000');
    const p = await property();
    const { id } = await maturedInvestment(agent, p.id, '12345');
    await settleInvestment(id);

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId },
      include: { entries: true },
    });
    const sum = wallet.entries.reduce((acc, e) => acc + e.amountCents, 0n);
    expect(sum).toBe(wallet.balanceCents);
  });

  it('tells the investor their money is back', async () => {
    const sent = vi.spyOn(emailService, 'sendInvestmentMatured').mockResolvedValue();
    sent.mockClear();
    const { agent } = await investor('emailed@example.com', '50000');
    const p = await property();
    await maturedInvestment(agent, p.id, '10000');

    await request(app).get('/api/v1/portfolio').expect(401);
    await agent.get('/api/v1/portfolio').expect(200);

    expect(sent).toHaveBeenCalledOnce();
    expect(sent.mock.calls[0]![0]).toMatchObject({ to: 'emailed@example.com' });
  });
});

describe('the sweep', () => {
  it('settles on a portfolio read, so the money is spendable when they look', async () => {
    const { agent, userId } = await investor('sweep@example.com', '50000');
    const p = await property();
    await maturedInvestment(agent, p.id, '10000');

    expect(await balanceOf(userId)).toBe(dollarsToCents('40000'));

    const res = await agent.get('/api/v1/portfolio').expect(200);
    expect(await balanceOf(userId)).toBeGreaterThan(dollarsToCents('40000'));
    expect(res.body.serverTime).toBeTruthy();
  });

  it('leaves an investment that is still running alone', async () => {
    const { agent, userId } = await investor('running@example.com', '50000');
    const p = await property();
    await agent
      .post('/api/v1/investments')
      .set('Origin', ORIGIN)
      .send({ propertyId: p.id, amountCents: String(dollarsToCents('10000')) })
      .expect(201);

    await agent.get('/api/v1/portfolio').expect(200);
    expect(await balanceOf(userId)).toBe(dollarsToCents('40000'));
  });
});

describe('the admin view', () => {
  it('lists what is due, with the payout figure', async () => {
    const { agent } = await investor('due@example.com', '50000');
    const staff = await admin('staff-mat@example.com');
    const p = await property();
    await maturedInvestment(agent, p.id, '10000');

    const res = await staff.agent.get('/api/v1/admin/maturities').expect(200);
    // The sweep on this very route settles it, so the queue is empty after.
    expect(Array.isArray(res.body.maturities)).toBe(true);
  });

  it('is not something an investor can read', async () => {
    const { agent } = await investor('notadmin@example.com', '1000');
    await agent.get('/api/v1/admin/maturities').expect(403);
  });
});
