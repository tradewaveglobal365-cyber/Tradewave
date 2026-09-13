import { encryptedBody } from '../../lib/klasha-crypto';
import { logger } from '../../lib/logger';
import type {
  ConfirmedPayment,
  CreateDepositAccountInput,
  DepositAccountDetails,
  PaymentProvider,
} from './types';

/**
 * Klasha — dedicated naira collection accounts.
 *
 * ── The security shape of this integration ────────────────────────────────
 * Klasha's webhooks carry NO signature. Their documentation describes the
 * events and the payload and says nothing about a signing secret, and there is
 * no header to verify. The endpoint is a public URL that anyone can POST to.
 *
 * So a webhook here is treated as a rumour, never as evidence. parseWebhook-
 * Reference pulls out a transaction reference and discards the rest of the
 * body — including the amount. Every figure that reaches the ledger comes back
 * from getPayment(), which asks Klasha directly over an authenticated call.
 *
 * The practical consequence: forging a webhook gets an attacker nothing better
 * than making us re-read a transaction that is either real or does not exist.
 */

/** Klasha reports success with this, and their docs show it lower-cased. */
const SUCCESS_STATUS = 'successful';

interface KlashaVirtualAccount {
  id?: number;
  accountNumber?: string;
  accountName?: string;
  bankName?: string;
  bankCode?: string;
  currency?: string;
}

interface KlashaTransaction {
  tnxRef?: string;
  status?: string;
  sourceAmount?: number | string;
  amountCollected?: number | string;
  amountCredited?: number | string;
  sourceCurrency?: string;
  destinationCurrency?: string;
  createdAt?: string;
  accountNumber?: string;
  customer?: { email?: string };
}

/**
 * Klasha quotes amounts in MAJOR units — 5000 means ₦5,000.00, not ₦50.00.
 *
 * Parsed via string rather than `Number * 100`, for the reason lib/money.ts
 * exists: 1650.55 * 100 is 165054.99999999997, and truncating that quietly
 * shorts the depositor a kobo on every single transfer.
 */
export function majorToMinor(value: number | string | undefined): bigint | null {
  if (value === undefined || value === null) return null;
  const raw = typeof value === 'number' ? value.toString() : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;

  const negative = raw.startsWith('-');
  const [whole = '0', fraction = ''] = raw.replace('-', '').split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -minor : minor;
}

export class KlashaPaymentProvider implements PaymentProvider {
  readonly name = 'klasha';

  /**
   * Klasha issues bearer tokens from an account email and password rather than
   * a machine credential, so the token is cached and refreshed instead of being
   * minted per request. Refreshed early, because a token that expires mid-flight
   * fails a call that moves money.
   */
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly publicKey: string,
    private readonly encryptionKey: string,
    private readonly accountEmail: string,
    private readonly accountPassword: string,
  ) {}

  private async bearer(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now()) return this.token.value;

    const res = await fetch(`${this.baseUrl}/auth/account/v2/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.accountEmail,
        password: this.accountPassword,
      }),
    });
    if (!res.ok) {
      throw new Error(`Klasha login failed: ${res.status}`);
    }
    const body = (await res.json()) as { data?: { token?: string; access_token?: string } };
    const value = body.data?.token ?? body.data?.access_token;
    if (!value) throw new Error('Klasha login returned no token');

    // 50 minutes. Their docs do not state a lifetime, so this is a conservative
    // guess backed by the 401 retry below rather than a documented value.
    this.token = { value, expiresAt: Date.now() + 50 * 60 * 1000 };
    return value;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { authenticated?: boolean } = {},
  ): Promise<T> {
    const { authenticated = true, ...rest } = init;

    const send = async (token: string | null): Promise<Response> =>
      fetch(`${this.baseUrl}${path}`, {
        ...rest,
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': this.publicKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...rest.headers,
        },
      });

    let res = await send(authenticated ? await this.bearer() : null);

    // One retry on 401 with a freshly minted token. The cached expiry above is a
    // guess; this is what actually makes it safe to guess.
    if (res.status === 401 && authenticated) {
      logger.info('Klasha token rejected — refreshing and retrying once');
      res = await send(await this.bearer(true));
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Klasha ${path} failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async createDepositAccount(
    input: CreateDepositAccountInput,
  ): Promise<DepositAccountDetails> {
    // Requery first. Klasha keys dedicated accounts on email, so asking for one
    // that already exists is the normal case after any retry — and creating a
    // second account for a user who already memorised a number would be worse
    // than failing outright.
    const existing = await this.findAccount(input.email);
    if (existing) return existing;

    const payload = {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      currency: 'NGN',
    };

    const body = await this.request<{ data?: KlashaVirtualAccount }>(
      '/wallet/virtual/v3/business/create/account',
      {
        method: 'POST',
        body: JSON.stringify(encryptedBody(payload, this.encryptionKey)),
      },
    );

    const account = this.toAccount(body.data);
    if (!account) throw new Error('Klasha created an account with no account number');
    return account;
  }

  private async findAccount(email: string): Promise<DepositAccountDetails | null> {
    try {
      const body = await this.request<{ data?: KlashaVirtualAccount }>(
        `/wallet/virtual/v2/account/${encodeURIComponent(email)}`,
      );
      return this.toAccount(body.data);
    } catch (err) {
      // A miss is the expected answer for a first-time user, and Klasha reports
      // it as an error status rather than an empty body. Swallowed so the caller
      // proceeds to create — but logged, so a genuine outage is not invisible.
      logger.debug({ err }, 'Klasha account requery returned nothing');
      return null;
    }
  }

  private toAccount(data: KlashaVirtualAccount | undefined): DepositAccountDetails | null {
    if (!data?.accountNumber) return null;
    return {
      providerRef: data.id !== undefined ? String(data.id) : null,
      accountNumber: data.accountNumber,
      accountName: data.accountName ?? 'Tradewave',
      bankName: data.bankName ?? 'Bank',
      bankCode: data.bankCode ?? null,
      currency: data.currency ?? 'NGN',
    };
  }

  async getPayment(providerRef: string): Promise<ConfirmedPayment | null> {
    try {
      const body = await this.request<{ data?: KlashaTransaction }>(
        '/nucleus/tnx/merchant/status',
        { method: 'POST', body: JSON.stringify({ tnxRef: providerRef }) },
      );
      return this.toPayment(body.data);
    } catch (err) {
      // Klasha answers 400 "Transaction not found." for an unknown reference,
      // which is exactly what a forged webhook produces. Not an error worth
      // raising — the caller's correct response is to do nothing.
      logger.warn({ providerRef, err }, 'Klasha transaction status lookup failed');
      return null;
    }
  }

  async listRecentPayments(limit: number): Promise<ConfirmedPayment[]> {
    try {
      const body = await this.request<{ data?: { content?: KlashaTransaction[] } | KlashaTransaction[] }>(
        '/nucleus/tnx/paginated/filter/v2',
        {
          method: 'POST',
          body: JSON.stringify({ status: SUCCESS_STATUS, size: limit, page: 0 }),
        },
      );
      const rows = Array.isArray(body.data) ? body.data : (body.data?.content ?? []);
      return rows
        .map((row) => this.toPayment(row))
        .filter((p): p is ConfirmedPayment => p !== null);
    } catch (err) {
      logger.warn({ err }, 'Klasha transaction sweep failed');
      return [];
    }
  }

  private toPayment(data: KlashaTransaction | undefined): ConfirmedPayment | null {
    if (!data?.tnxRef) return null;
    if (data.status?.toLowerCase() !== SUCCESS_STATUS) return null;

    // amountCredited is what Klasha actually placed in the wallet, net of their
    // fee; amountCollected is the gross. Credit the net — crediting the gross
    // would hand the depositor money the business never received.
    const amountMinor =
      majorToMinor(data.amountCredited) ??
      majorToMinor(data.amountCollected) ??
      majorToMinor(data.sourceAmount);
    if (amountMinor === null || amountMinor <= 0n) return null;

    return {
      providerRef: data.tnxRef,
      amountMinor,
      currency: data.sourceCurrency ?? data.destinationCurrency ?? 'NGN',
      customerEmail: data.customer?.email ?? null,
      accountNumber: data.accountNumber ?? null,
      paidAt: data.createdAt ? new Date(data.createdAt) : null,
    };
  }

  /**
   * Pulls the transaction reference out of a webhook body. Nothing else is read.
   *
   * Klasha's charge.completed carries an amount, a currency and a customer, and
   * all of it is ignored on purpose — see the note at the top of this file. The
   * reference is a lookup key, not a claim, so trusting it costs nothing.
   */
  parseWebhookReference(body: unknown): string | null {
    if (typeof body !== 'object' || body === null) return null;
    const payload = body as { tnxRef?: unknown; data?: { tnxRef?: unknown } };
    const ref = payload.data?.tnxRef ?? payload.tnxRef;
    return typeof ref === 'string' && ref.length > 0 ? ref : null;
  }
}
