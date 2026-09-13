import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { paymentProvider } from '../services/payments';
import { KlashaPaymentProvider, majorToMinor } from '../services/payments/klasha';
import { decryptPayload, encryptPayload, encryptedBody } from '../lib/klasha-crypto';
import { migrateTestDatabase, resetDatabase } from './helpers';

const app = createApp();
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';
const KEY_24 = '0123456789abcdef01234567';

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

async function createVerifiedUser(email: string) {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ firstName: 'Ada', lastName: 'Okafor', email, password: PASSWORD });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/verify-email')
    .set('Origin', ORIGIN)
    .send({ token });
  const userId = res.body.user.id as string;
  await prisma.user.update({
    where: { id: userId },
    data: { kycStatus: 'VERIFIED', kycVerifiedAt: new Date() },
  });
  return { agent, userId };
}

async function setRate(minorPerUnit: bigint) {
  await prisma.fxRate.create({
    data: { baseCurrency: 'USD', quoteCurrency: 'NGN', minorPerUnit },
  });
}

describe('3DES payload encryption', () => {
  it('round-trips a payload through Klasha’s scheme', () => {
    const payload = { firstName: 'Ada', lastName: 'Okafor', currency: 'NGN' };
    const encrypted = encryptPayload(payload, KEY_24);
    expect(decryptPayload(encrypted, KEY_24)).toBe(JSON.stringify(payload));
  });

  it('wraps the ciphertext in the message envelope their API expects', () => {
    const body = encryptedBody({ a: 1 }, KEY_24);
    expect(Object.keys(body)).toEqual(['message']);
    expect(body.message).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('is deterministic, because the IV is derived from the key', () => {
    // Not a property we want — it is what Klasha specifies. Asserted so that if
    // they ever switch to a random IV, this test fails and tells us why.
    expect(encryptPayload({ a: 1 }, KEY_24)).toBe(encryptPayload({ a: 1 }, KEY_24));
  });

  it('refuses a key that is not exactly 24 bytes rather than reshaping it', () => {
    // A padded or truncated key produces ciphertext the far end rejects with a
    // generic error, and the hours that follow are spent looking anywhere else.
    expect(() => encryptPayload({ a: 1 }, 'too-short')).toThrow(/24 bytes/);
    expect(() => encryptPayload({ a: 1 }, `${KEY_24}extra`)).toThrow(/24 bytes/);
  });
});

describe('parsing provider amounts', () => {
  it('reads major units into minor without a float round-trip', () => {
    // 1650.55 * 100 is 165054.99999999997 in floating point, which truncates to
    // 165054 and quietly shorts the depositor a kobo on every transfer.
    expect(majorToMinor('1650.55')).toBe(165_055n);
    expect(majorToMinor(1650.55)).toBe(165_055n);
    expect(majorToMinor('5000')).toBe(500_000n);
    expect(majorToMinor('0.5')).toBe(50n);
  });

  it('returns null for anything that is not an amount', () => {
    for (const bad of [undefined, '', 'abc', '1,000', '₦500']) {
      expect(majorToMinor(bad as string)).toBeNull();
    }
  });
});

describe('webhook reference extraction', () => {
  const klasha = new KlashaPaymentProvider('https://example.test', 'pk', KEY_24, 'a@b.c', 'pw');

  it('reads tnxRef from either the envelope or the data object', () => {
    expect(klasha.parseWebhookReference({ tnxRef: 'abc' })).toBe('abc');
    expect(klasha.parseWebhookReference({ data: { tnxRef: 'def' } })).toBe('def');
  });

  it('returns null when there is no usable reference', () => {
    for (const bad of [null, undefined, 'string', 42, {}, { tnxRef: 123 }, { tnxRef: '' }]) {
      expect(klasha.parseWebhookReference(bad)).toBeNull();
    }
  });
});

describe('the deposit webhook', () => {
  it('credits nothing from the body alone — the amount is never read from it', async () => {
    const { agent, userId } = await createVerifiedUser('forge@example.com');
    await setRate(165_000n);
    await agent.get('/api/v1/wallet/deposit-account');

    // A forged webhook claiming a large payment. The provider will not confirm
    // the reference, so this must move nothing.
    vi.spyOn(paymentProvider, 'getPayment').mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/wallet/deposits/webhook')
      .send({
        event: 'charge.completed',
        data: {
          tnxRef: 'forged-reference',
          status: 'successful',
          amountCredited: 99_000_000,
          customer: { email: 'forge@example.com' },
        },
      });

    expect(res.status).toBe(200);
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(wallet?.balanceCents ?? 0n).toBe(0n);
    expect(await prisma.deposit.count()).toBe(0);
  });

  it('credits what the provider confirms, not what the webhook claimed', async () => {
    const { agent, userId } = await createVerifiedUser('real@example.com');
    await setRate(165_000n);
    await agent.get('/api/v1/wallet/deposit-account');

    // Provider says ₦1,650,000.00 arrived. The webhook body below claims ten
    // times that; the credited figure has to follow the provider.
    vi.spyOn(paymentProvider, 'getPayment').mockResolvedValue({
      providerRef: 'tnx-1',
      amountMinor: 165_000_000n,
      currency: 'NGN',
      customerEmail: 'real@example.com',
      accountNumber: null,
      paidAt: new Date(),
    });

    await request(app)
      .post('/api/v1/wallet/deposits/webhook')
      .send({ data: { tnxRef: 'tnx-1', amountCredited: 16_500_000 } })
      .expect(200);

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(wallet?.balanceCents).toBe(100_000n); // $1,000.00

    const deposit = await prisma.deposit.findUnique({ where: { providerRef: 'tnx-1' } });
    expect(deposit?.status).toBe('SUCCESS');
    expect(deposit?.sourceAmountMinor).toBe(165_000_000n);
    expect(deposit?.rateMinorPerUnit).toBe(165_000n);
  });

  it('credits exactly once when the same webhook is replayed', async () => {
    const { agent, userId } = await createVerifiedUser('replay@example.com');
    await setRate(165_000n);
    await agent.get('/api/v1/wallet/deposit-account');

    vi.spyOn(paymentProvider, 'getPayment').mockResolvedValue({
      providerRef: 'tnx-replay',
      amountMinor: 165_000_000n,
      currency: 'NGN',
      customerEmail: 'replay@example.com',
      accountNumber: null,
      paidAt: new Date(),
    });

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/v1/wallet/deposits/webhook')
        .send({ data: { tnxRef: 'tnx-replay' } })
        .expect(200);
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(wallet?.balanceCents).toBe(100_000n);
    expect(await prisma.ledgerEntry.count({ where: { type: 'DEPOSIT' } })).toBe(1);
  });

  it('answers 200 for a reference that belongs to nobody', async () => {
    vi.spyOn(paymentProvider, 'getPayment').mockResolvedValue(null);
    await request(app)
      .post('/api/v1/wallet/deposits/webhook')
      .send({ data: { tnxRef: 'unknown' } })
      .expect(200);
    expect(await prisma.deposit.count()).toBe(0);
  });

  it('holds a payment rather than losing it when no rate is set', async () => {
    const { userId } = await createVerifiedUser('norate@example.com');
    // Deliberately no setRate() — the money arrives before an admin has
    // published a rate, which must not mean the transfer vanishes.
    vi.spyOn(paymentProvider, 'getPayment').mockResolvedValue({
      providerRef: 'tnx-norate',
      amountMinor: 165_000_000n,
      currency: 'NGN',
      customerEmail: 'norate@example.com',
      accountNumber: null,
      paidAt: new Date(),
    });

    await request(app)
      .post('/api/v1/wallet/deposits/webhook')
      .send({ data: { tnxRef: 'tnx-norate' } })
      .expect(200);

    const deposit = await prisma.deposit.findUnique({ where: { providerRef: 'tnx-norate' } });
    expect(deposit?.status).toBe('PENDING');
    expect(deposit?.sourceAmountMinor).toBe(165_000_000n);
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(wallet?.balanceCents ?? 0n).toBe(0n);
  });

  it('does not restate an existing deposit when the rate later changes', async () => {
    const { agent, userId } = await createVerifiedUser('pinned@example.com');
    await setRate(165_000n);
    await agent.get('/api/v1/wallet/deposit-account');

    vi.spyOn(paymentProvider, 'getPayment').mockResolvedValue({
      providerRef: 'tnx-pinned',
      amountMinor: 165_000_000n,
      currency: 'NGN',
      customerEmail: 'pinned@example.com',
      accountNumber: null,
      paidAt: new Date(),
    });
    await request(app)
      .post('/api/v1/wallet/deposits/webhook')
      .send({ data: { tnxRef: 'tnx-pinned' } })
      .expect(200);

    // The naira devalues sharply; the admin republishes. The deposit already
    // credited must keep the number the depositor was quoted.
    await setRate(330_000n);
    await request(app)
      .post('/api/v1/wallet/deposits/webhook')
      .send({ data: { tnxRef: 'tnx-pinned' } })
      .expect(200);

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(wallet?.balanceCents).toBe(100_000n);
    const deposit = await prisma.deposit.findUnique({ where: { providerRef: 'tnx-pinned' } });
    expect(deposit?.rateMinorPerUnit).toBe(165_000n);
  });
});
