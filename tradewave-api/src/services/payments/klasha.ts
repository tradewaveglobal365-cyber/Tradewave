import { encryptedBody } from '../../lib/klasha-crypto';
import { logger } from '../../lib/logger';
import type {
  Bank,
  ConfirmedPayment,
  CreateDepositAccountInput,
  DepositAccountDetails,
  PaymentProvider,
  PayoutResult,
  PayoutState,
  PayoutStatus,
  SendPayoutInput,
  WebhookEvent,
} from './types';

/**
 * Klasha — dedicated naira collection accounts, and naira payouts.
 *
 * ── The security shape of this integration ────────────────────────────────
 * Klasha's webhooks carry NO signature. Their documentation describes the
 * events and the payload and says nothing about a signing secret, and there is
 * no header to verify. The endpoint is a public URL that anyone can POST to.
 *
 * So a webhook here is treated as a rumour, never as evidence. parseWebhook-
 * Event pulls out a KIND and a reference and discards the rest of the body —
 * including the amount. Every figure that reaches the ledger comes back from
 * getPayment(), which asks Klasha directly over an authenticated call.
 *
 * The practical consequence: forging a webhook gets an attacker nothing better
 * than making us re-read a transaction that is either real or does not exist.
 *
 * ── One URL, three kinds of event ─────────────────────────────────────────
 * Klasha posts collections, payouts and refunds to the SAME webhook URL, told
 * apart only by `event`. They also use different reference fields per kind:
 * collections and refunds carry `tnxRef`, payouts carry `reference`. Reading a
 * reference without first reading the kind is how an outbound payout gets fed
 * to the code that credits wallets, so parseWebhookEvent reads the kind first
 * and refuses to guess.
 */

/** Klasha reports success with this, and their docs show it lower-cased. */
const SUCCESS_STATUS = 'successful';

/**
 * A non-2xx from Klasha, carrying the status code rather than burying it in a
 * message string.
 *
 * The code is what separates the two failures that matter when SENDING money.
 * A 4xx means Klasha understood the request and refused it — a bad account
 * number, an empty naira float — so the money definitely did not move and the
 * caller can safely give it back. A 5xx, a timeout or a dropped socket means
 * nothing of the sort: the transfer may well have gone through. Collapsing the
 * two is how somebody gets paid twice.
 */
export class KlashaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'KlashaHttpError';
  }

  /** Klasha answers {message, error}; either may carry the useful sentence. */
  get reason(): string {
    try {
      const parsed = JSON.parse(this.body) as { message?: unknown; error?: unknown };
      for (const value of [parsed.error, parsed.message]) {
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    } catch {
      // Not JSON. Fall through to the raw body.
    }
    return this.body.trim() || `Klasha refused the request (${this.status}).`;
  }
}

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
    /** Appears in the payout URL path. Collections do not need it. */
    private readonly businessId: string = '',
  ) {}

  private async bearer(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now()) return this.token.value;

    const res = await fetch(`${this.baseUrl}/auth/account/v2/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Their authentication page: "Ensure to include this in all request
        // headers as value for x-auth-token". ALL includes this one. Without
        // it the login answers 403 — not 401 — which reads like bad
        // credentials and is not: the request is rejected before it is ever
        // checked against an account.
        'x-auth-token': this.publicKey,
      },
      body: JSON.stringify({
        username: this.accountEmail,
        password: this.accountPassword,
      }),
    });
    if (!res.ok) {
      // The status alone says almost nothing — 403 covers a missing key header,
      // a key from the wrong environment, and an account not enabled for live.
      // Klasha's body distinguishes them, so it goes in the message the way
      // request() already does. Response body only; no credential is echoed.
      const detail = await res.text().catch(() => '');
      throw new Error(`Klasha login failed: ${res.status} ${detail.slice(0, 200)}`);
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
      throw new KlashaHttpError(
        res.status,
        body,
        `Klasha ${path} failed: ${res.status} ${body.slice(0, 200)}`,
      );
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

  /**
   * Cached for a day. The list changes rarely, every investor adding a payout
   * account loads it, and Klasha's own latency is not something to pay per form
   * render.
   */
  private banks: { at: number; value: Bank[] } | null = null;

  async listBanks(currency: string): Promise<Bank[]> {
    const DAY = 24 * 60 * 60 * 1000;
    if (this.banks && Date.now() - this.banks.at < DAY) return this.banks.value;

    const body = await this.request<{ data?: { code?: string; name?: string }[] }>(
      `/wallet/merchant/bank/transfer/request/banks/${encodeURIComponent(currency)}`,
    );
    const value = (body.data ?? [])
      .filter((b): b is { code: string; name: string } => Boolean(b.code && b.name))
      // Klasha returns names with stray leading spaces (" OJOKORO MICROFINANCE
      // BANK" in their own documented example), which sorts them to the top of
      // a dropdown for no reason.
      .map((b) => ({ code: b.code, name: b.name.trim() }))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.banks = { at: Date.now(), value };
    return value;
  }

  /**
   * Asks the bank who owns an account — the NIBSS name enquiry every Nigerian
   * transfer screen does before you confirm.
   *
   * This is what turns the payout name check from "the name you typed matches
   * your identity" into "the BANK says this account is yours". See
   * payout.service: when this returns a name, the user's typing is ignored.
   *
   * Plain JSON, unlike the payout body on the same page, which is 3DES
   * encrypted. Their docs are explicit about that split, and it is the kind of
   * inconsistency worth stating rather than discovering.
   */
  async resolveAccountName(
    bankCode: string,
    accountNumber: string,
  ): Promise<string | null> {
    try {
      const body = await this.request<{ data?: { account_name?: string } }>(
        '/wallet/merchant/bank/transfer/request/resolve/account',
        {
          method: 'POST',
          // countryCode is fixed: this driver resolves NGN accounts, which is
          // the only currency Tradewave pays out in.
          body: JSON.stringify({ bankCode, countryCode: 'NG', accountNumber }),
        },
      );
      const name = body.data?.account_name?.trim();
      return name && name.length > 0 ? name : null;
    } catch (err) {
      // A wrong account number is an ordinary outcome here, not an incident —
      // the caller falls back to the typed name rather than refusing the save.
      logger.info({ bankCode, err }, 'Klasha could not resolve that account');
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
   * Classifies a webhook body. Nothing else is read.
   *
   * Klasha's charge.completed carries an amount, a currency and a customer, and
   * all of it is ignored on purpose — see the note at the top of this file. A
   * reference is a lookup key, not a claim, so trusting it costs nothing.
   *
   * The `event` field decides the kind. An unrecognised event is null rather
   * than a guess: Klasha sends kinds we have no interest in, and "it has a
   * tnxRef so it must be a collection" is exactly the inference that would let
   * a payout notification credit a wallet.
   */
  parseWebhookEvent(body: unknown): WebhookEvent | null {
    if (typeof body !== 'object' || body === null) return null;
    const payload = body as {
      event?: unknown;
      data?: { tnxRef?: unknown; reference?: unknown; status?: unknown } | undefined;
      tnxRef?: unknown;
    };

    const event = typeof payload.event === 'string' ? payload.event.toLowerCase() : null;

    if (event === 'payout') {
      // Payouts identify themselves by `reference`, NOT by tnxRef. That is
      // Klasha's inconsistency, not ours, and it is the reason this method
      // exists: the old parser read tnxRef only, so a payout webhook came back
      // as null and was silently dropped.
      const ref = payload.data?.reference;
      if (typeof ref !== 'string' || !ref) return null;
      return { kind: 'payout', reference: ref, state: toPayoutState(payload.data?.status) };
    }

    if (event === null || event.startsWith('charge')) {
      // No event field at all is treated as a collection for compatibility:
      // that is the shape Klasha sent before they documented `event`, and a
      // deposit that stops crediting is a worse failure than one extra
      // authenticated lookup. It is safe precisely because a collection is
      // verified against getPayment() before a cent moves.
      const ref = payload.data?.tnxRef ?? payload.tnxRef;
      if (typeof ref !== 'string' || !ref) return null;
      return { kind: 'collection', reference: ref };
    }

    return null;
  }

  // ── Money going out ────────────────────────────────────────────────────────

  /**
   * Sends naira to a bank account.
   *
   * Two things about this endpoint differ from every other call in this file.
   * The business id sits in the PATH rather than a header, and the body is
   * 3DES-encrypted — while the account-resolve call on the same documentation
   * page is plain JSON. Getting that split backwards fails with a generic
   * provider error and no clue which half was wrong.
   *
   * `amount` goes over as a NUMBER in whole naira, not kobo. The caller pins a
   * figure that is already a whole number of naira, so nothing is rounded here
   * — if that ever stops being true this should throw rather than truncate
   * somebody's money silently.
   */
  async sendPayout(input: SendPayoutInput): Promise<PayoutResult> {
    if (!this.businessId) {
      throw new Error('KLASHA_BUSINESS_ID is not set — the payout URL cannot be built');
    }
    if (input.amountMinor % 100n !== 0n) {
      throw new Error(
        `Payout amount must be a whole number of naira, got ${input.amountMinor} kobo`,
      );
    }

    const payload = {
      amount: Number(input.amountMinor / 100n),
      country: input.country,
      currency: input.currency,
      bankCode: input.bankCode,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      accountName: input.accountName,
      requestId: input.requestId,
      description: input.description,
    };

    try {
      const body = await this.request<{ data?: KlashaPayout }>(
        `/wallet/merchant/${encodeURIComponent(this.businessId)}/bank/transfer/v2/request`,
        {
          method: 'POST',
          body: JSON.stringify(encryptedBody(payload, this.encryptionKey)),
        },
      );

      // Accepted. Whether it has SETTLED is a different question, answered by
      // the webhook or by getPayout — so a missing status here is 'sent', not
      // an error: Klasha took the request either way.
      return { state: 'sent', providerRef: payoutRef(body.data) };
    } catch (err) {
      // 4xx: they understood and refused. Safe to return the money.
      if (err instanceof KlashaHttpError && err.status >= 400 && err.status < 500) {
        logger.warn(
          { requestId: input.requestId, status: err.status },
          'Klasha refused a payout',
        );
        return { state: 'refused', reason: err.reason };
      }
      // Anything else — 5xx, timeout, dropped socket — means we do not know
      // whether the money moved. Rethrown so the caller leaves the withdrawal
      // alone rather than crediting it back and paying twice.
      throw err;
    }
  }

  /**
   * Where a payout stands, by our own requestId.
   *
   * Klasha's guidance is to rely on the webhook rather than to poll, and their
   * transfer lookup is not documented as clearly as the collection one. So this
   * reuses the merchant status endpoint and is deliberately conservative: an
   * answer it cannot read confidently comes back as null, and the sweep leaves
   * the withdrawal exactly where it was. A wrong guess here would either strand
   * money or return money that has already been sent.
   */
  async getPayout(requestId: string): Promise<PayoutStatus | null> {
    try {
      const body = await this.request<{ data?: KlashaPayout }>(
        '/nucleus/tnx/merchant/status',
        { method: 'POST', body: JSON.stringify({ tnxRef: requestId }) },
      );
      const data = body.data;
      if (!data) return null;

      const raw = data.payoutStatus ?? data.status;
      if (typeof raw !== 'string' || !raw.trim()) return null;

      return {
        state: toPayoutState(raw),
        providerRef: payoutRef(data),
        reason: typeof data.reason === 'string' ? data.reason : null,
      };
    } catch (err) {
      // An unknown reference is an ordinary answer here, not an incident: a
      // transfer Klasha has not registered yet looks exactly like this.
      logger.info({ requestId, err }, 'Klasha could not report on that payout');
      return null;
    }
  }
}

/** The transfer body Klasha echoes back on create and on lookup. */
interface KlashaPayout {
  id?: unknown;
  requestId?: unknown;
  reference?: unknown;
  payoutStatus?: unknown;
  status?: unknown;
  reason?: unknown;
}

/** Their reference for the transfer, under whichever key they used. */
function payoutRef(data: KlashaPayout | undefined): string | null {
  for (const value of [data?.reference, data?.id]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

/**
 * Klasha's status word, mapped.
 *
 * Anything unrecognised becomes 'pending' rather than 'failed'. Pending is the
 * state that causes us to look again; failed is the state that hands money
 * back. A word we have never seen before must not do the second one.
 */
function toPayoutState(value: unknown): PayoutState {
  const word = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (word === SUCCESS_STATUS || word === 'success' || word === 'completed') return 'successful';
  if (word === 'failed' || word === 'failure' || word === 'reversed') return 'failed';
  return 'pending';
}
