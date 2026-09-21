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
    .send({ firstName: 'Ada', lastName: 'Okafor', email, password: PASSWORD, phone: '08030000000' });
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

describe('webhook classification', () => {
  const klasha = new KlashaPaymentProvider('https://example.test', 'pk', KEY_24, 'a@b.c', 'pw');

  it('reads tnxRef from either the envelope or the data object', () => {
    expect(klasha.parseWebhookEvent({ tnxRef: 'abc' })).toEqual({
      kind: 'collection',
      reference: 'abc',
    });
    expect(klasha.parseWebhookEvent({ data: { tnxRef: 'def' } })).toEqual({
      kind: 'collection',
      reference: 'def',
    });
    expect(
      klasha.parseWebhookEvent({ event: 'charge.completed', data: { tnxRef: 'ghi' } }),
    ).toEqual({ kind: 'collection', reference: 'ghi' });
  });

  it('returns null when there is no usable reference', () => {
    for (const bad of [null, undefined, 'string', 42, {}, { tnxRef: 123 }, { tnxRef: '' }]) {
      expect(klasha.parseWebhookEvent(bad)).toBeNull();
    }
  });

  /**
   * Klasha identifies a payout by `reference` and a collection by `tnxRef`, on
   * the same webhook URL. Reading a reference without first reading the kind is
   * how an outbound transfer gets fed to the code that credits wallets.
   */
  it('classifies a payout by its event, and reads reference rather than tnxRef', () => {
    expect(
      klasha.parseWebhookEvent({
        event: 'payout',
        data: { reference: 'kbtr-3857-011', status: 'successful' },
      }),
    ).toEqual({ kind: 'payout', reference: 'kbtr-3857-011', state: 'successful' });

    expect(
      klasha.parseWebhookEvent({
        event: 'payout',
        data: { reference: 'kbtr-9', status: 'failed' },
      }),
    ).toEqual({ kind: 'payout', reference: 'kbtr-9', state: 'failed' });
  });

  it('never reports a payout as a collection, even when one carries a tnxRef', () => {
    const event = klasha.parseWebhookEvent({
      event: 'payout',
      data: { reference: 'kbtr-1', tnxRef: 'looks-like-a-deposit', status: 'successful' },
    });
    expect(event?.kind).toBe('payout');
    expect(event).not.toMatchObject({ reference: 'looks-like-a-deposit' });
  });

  it('maps an unrecognised status to pending rather than failed', () => {
    // Pending makes us look again; failed hands money back. A word we have
    // never seen before must not do the second one.
    const event = klasha.parseWebhookEvent({
      event: 'payout',
      data: { reference: 'kbtr-2', status: 'something-new' },
    });
    expect(event).toEqual({ kind: 'payout', reference: 'kbtr-2', state: 'pending' });
  });

  it('ignores event kinds it has no interest in', () => {
    expect(
      klasha.parseWebhookEvent({ event: 'refund.completed', data: { tnxRef: 'r1' } }),
    ).toBeNull();
  });
});

describe('sending a payout', () => {
  const BUSINESS = 'biz-77';

  /** Stands in for login + the payout call, in that order. */
  function mockFetch(payout: { status: number; body: unknown }) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/auth/account/v2/login')) {
        return new Response(JSON.stringify({ data: { token: 'tok' } }), { status: 200 });
      }
      return new Response(JSON.stringify(payout.body), { status: payout.status });
    });
  }

  function provider() {
    // A fresh provider each time: a shared one caches its token, so a header
    // assertion against it would pass vacuously.
    return new KlashaPaymentProvider(
      'https://example.test',
      'pk',
      KEY_24,
      'a@b.c',
      'pw',
      BUSINESS,
    );
  }

  const input = {
    requestId: 'twd_abc',
    amountMinor: 4_900_000n, // ₦49,000
    currency: 'NGN',
    country: 'NG',
    bankCode: '044',
    bankName: 'Access Bank',
    accountNumber: '0123456789',
    accountName: 'JOSHUA OKOGHIE',
    description: 'Tradewave withdrawal',
  };

  it('posts an encrypted body to the business payout path, with their headers', async () => {
    const fetchSpy = mockFetch({
      status: 200,
      body: { data: { reference: 'kbtr-1', payoutStatus: 'pending' } },
    });

    const result = await provider().sendPayout(input);
    expect(result).toEqual({ state: 'sent', providerRef: 'kbtr-1' });

    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(
      `https://example.test/wallet/merchant/${BUSINESS}/bank/transfer/v2/request`,
    );

    const headers = init.headers as Record<string, string>;
    expect(headers['x-auth-token']).toBe('pk');
    expect(headers.Authorization).toBe('Bearer tok');

    // The body is 3DES-encrypted, unlike the resolve call on the same docs page.
    const sent = JSON.parse(String(init.body)) as { message: string };
    const payload = JSON.parse(decryptPayload(sent.message, KEY_24)) as Record<string, unknown>;
    expect(payload).toEqual({
      // Whole NAIRA as a number, not kobo — their field, their unit.
      amount: 49_000,
      country: 'NG',
      currency: 'NGN',
      bankCode: '044',
      bankName: 'Access Bank',
      accountNumber: '0123456789',
      accountName: 'JOSHUA OKOGHIE',
      requestId: 'twd_abc',
      description: 'Tradewave withdrawal',
    });
  });

  it('reports a 4xx as refused, carrying the provider’s own words', async () => {
    mockFetch({ status: 400, body: { error: 'Insufficient wallet balance' } });

    const result = await provider().sendPayout(input);
    expect(result).toEqual({ state: 'refused', reason: 'Insufficient wallet balance' });
  });

  /**
   * The distinction the whole design rests on. A 4xx means the money did not
   * move and can be given back; a 5xx or a dropped socket means we do not know,
   * and returning the money there is how somebody gets paid twice.
   */
  it('THROWS on a 5xx rather than reporting a refusal', async () => {
    mockFetch({ status: 502, body: { message: 'Bad gateway' } });
    await expect(provider().sendPayout(input)).rejects.toThrow();
  });

  it('throws on a network failure rather than reporting a refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (i) => {
      if (String(i).includes('/auth/account/v2/login')) {
        return new Response(JSON.stringify({ data: { token: 'tok' } }), { status: 200 });
      }
      throw new TypeError('socket hang up');
    });
    await expect(provider().sendPayout(input)).rejects.toThrow();
  });

  it('refuses to send a fraction of a naira rather than truncating it', async () => {
    mockFetch({ status: 200, body: { data: {} } });
    await expect(
      provider().sendPayout({ ...input, amountMinor: 4_900_050n }),
    ).rejects.toThrow(/whole number of naira/);
  });

  it('refuses to build a payout URL with no business id', async () => {
    const noBusiness = new KlashaPaymentProvider(
      'https://example.test',
      'pk',
      KEY_24,
      'a@b.c',
      'pw',
    );
    await expect(noBusiness.sendPayout(input)).rejects.toThrow(/KLASHA_BUSINESS_ID/);
  });
});

describe('resolving a bank account', () => {
  const klasha = new KlashaPaymentProvider('https://example.test', 'pk', KEY_24, 'a@b.c', 'pw');

  /** Stands in for login + the resolve call, in that order. */
  function mockFetch(resolveResponse: { ok: boolean; body: unknown }) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/auth/account/v2/login')) {
        return new Response(JSON.stringify({ data: { token: 'tok' } }), { status: 200 });
      }
      return new Response(JSON.stringify(resolveResponse.body), {
        status: resolveResponse.ok ? 200 : 400,
      });
    });
  }

  it('returns the name the bank holds', async () => {
    mockFetch({ ok: true, body: { data: { account_number: '9067777000', account_name: 'JOHN JANE DOE' } } });
    await expect(klasha.resolveAccountName('044', '9067777000')).resolves.toBe('JOHN JANE DOE');
  });

  it('sends plain JSON, not an encrypted envelope', async () => {
    // The payout body on the same documentation page IS 3DES encrypted and this
    // one is not. Getting that backwards fails with a generic provider error.
    const spy = mockFetch({ ok: true, body: { data: { account_name: 'JOHN DOE' } } });
    await klasha.resolveAccountName('044', '9067777000');

    const call = spy.mock.calls.find(([url]) => String(url).includes('resolve/account'));
    const sent = JSON.parse(String((call?.[1] as RequestInit).body));
    expect(sent).toEqual({ bankCode: '044', countryCode: 'NG', accountNumber: '9067777000' });
    expect(sent).not.toHaveProperty('message');
  });

  it('returns null for an account the bank does not know', async () => {
    // An ordinary outcome, not an incident: the caller falls back to the typed
    // name rather than refusing the save outright.
    mockFetch({ ok: false, body: { message: 'Account not found' } });
    await expect(klasha.resolveAccountName('044', '0000000000')).resolves.toBeNull();
  });

  it('returns null rather than an empty string when the name is blank', async () => {
    mockFetch({ ok: true, body: { data: { account_name: '   ' } } });
    await expect(klasha.resolveAccountName('044', '9067777000')).resolves.toBeNull();
  });

  // Production answered 403 on every Klasha call because the login request was
  // the one place the merchant key was not sent. Their docs say "all request
  // headers"; this pins that the login is included in "all".
  it('sends the merchant key on the login request itself', async () => {
    const spy = mockFetch({ ok: true, body: { data: { account_name: 'JOHN DOE' } } });
    // A fresh provider: the shared one above has already cached a token, so it
    // would never hit the login endpoint and the assertion would pass vacuously.
    const fresh = new KlashaPaymentProvider('https://example.test', 'pk', KEY_24, 'a@b.c', 'pw');
    await fresh.resolveAccountName('044', '9067777000');

    const login = spy.mock.calls.find(([url]) => String(url).includes('/auth/account/v2/login'));
    const headers = (login?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-auth-token']).toBe('pk');
  });

  it('puts Klasha’s own words in the login error', async () => {
    // A bare status sent us looking in the wrong place once already.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid merchant key' }), { status: 403 }),
    );
    await expect(klasha.listBanks('NGN')).rejects.toThrow(/403.*Invalid merchant key/);
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
