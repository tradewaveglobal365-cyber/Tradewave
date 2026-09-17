import { randomUUID } from 'node:crypto';
import { env, isProduction } from '../../config/env';
import { logger } from '../../lib/logger';
import { KlashaPaymentProvider } from './klasha';
import type {
  Bank,
  ConfirmedPayment,
  CreateDepositAccountInput,
  DepositAccountDetails,
  PaymentProvider,
  PayoutResult,
  PayoutStatus,
  SendPayoutInput,
  WebhookEvent,
} from './types';

export type {
  PaymentProvider,
  ConfirmedPayment,
  DepositAccountDetails,
  Bank,
  PayoutResult,
  PayoutState,
  PayoutStatus,
  SendPayoutInput,
  WebhookEvent,
} from './types';

/**
 * Stand-in driver used until Klasha credentials exist.
 *
 * Issues a plausible-looking account so the wallet screen can be built and
 * demoed, and holds simulated payments in memory so the credit path — which is
 * the part that actually moves money — is exercisable end to end without a
 * provider account.
 *
 * In production it still issues nothing and confirms nothing. A stub must never
 * be able to put money in a balance on a deployment a client is watching.
 */
export class StubPaymentProvider implements PaymentProvider {
  readonly name = 'stub';

  /** Simulated inbound payments, keyed by reference. Never persisted. */
  private readonly payments = new Map<string, ConfirmedPayment>();

  async createDepositAccount(
    input: CreateDepositAccountInput,
  ): Promise<DepositAccountDetails> {
    if (isProduction) {
      throw new Error('No payment provider configured — refusing to issue an account');
    }
    // Deterministic per user, so the number does not change between restarts
    // and looks like something a person could write down.
    const digits = BigInt(`0x${Buffer.from(input.userId).toString('hex').slice(0, 12)}`)
      .toString()
      .padStart(10, '0')
      .slice(-10);
    return {
      providerRef: `stub_${input.userId.slice(0, 8)}`,
      accountNumber: digits,
      accountName: `Tradewave / ${input.firstName} ${input.lastName}`,
      bankName: 'Stub Bank (test)',
      bankCode: '000',
      currency: 'NGN',
    };
  }

  async getPayment(providerRef: string): Promise<ConfirmedPayment | null> {
    return this.payments.get(providerRef) ?? null;
  }

  async listRecentPayments(limit: number): Promise<ConfirmedPayment[]> {
    return [...this.payments.values()].slice(0, limit);
  }

  /**
   * A handful of real Nigerian banks, so the form is usable without Klasha
   * credentials. Codes are the genuine NIBSS ones — a fake code in a dropdown
   * would be a payout that silently fails later.
   */
  async listBanks(): Promise<Bank[]> {
    return [
      { code: '044', name: 'Access Bank' },
      { code: '058', name: 'Guaranty Trust Bank' },
      { code: '057', name: 'Zenith Bank' },
      { code: '033', name: 'United Bank for Africa' },
      { code: '011', name: 'First Bank of Nigeria' },
      { code: '221', name: 'Stanbic IBTC Bank' },
      { code: '232', name: 'Sterling Bank' },
      { code: '50211', name: 'Kuda Microfinance Bank' },
      { code: '999992', name: 'OPay' },
      { code: '999991', name: 'PalmPay' },
    ];
  }

  /** No remote side to ask, so the caller falls back to the typed name. */
  async resolveAccountName(): Promise<string | null> {
    return null;
  }

  parseWebhookEvent(body: unknown): WebhookEvent | null {
    if (typeof body !== 'object' || body === null) return null;
    const payload = body as {
      event?: unknown;
      data?: { tnxRef?: unknown; reference?: unknown; status?: unknown } | undefined;
      tnxRef?: unknown;
    };

    const event = typeof payload.event === 'string' ? payload.event.toLowerCase() : null;

    if (event === 'payout') {
      const ref = payload.data?.reference;
      if (typeof ref !== 'string' || !ref) return null;
      const status = typeof payload.data?.status === 'string' ? payload.data.status : '';
      return {
        kind: 'payout',
        reference: ref,
        state:
          status === 'successful' ? 'successful' : status === 'failed' ? 'failed' : 'pending',
      };
    }

    if (event === null || event.startsWith('charge')) {
      const ref = payload.data?.tnxRef ?? payload.tnxRef;
      if (typeof ref !== 'string' || !ref) return null;
      return { kind: 'collection', reference: ref };
    }

    return null;
  }

  /** Simulated outbound transfers, keyed by OUR requestId. Never persisted. */
  private readonly payouts = new Map<string, PayoutStatus>();

  async sendPayout(input: SendPayoutInput): Promise<PayoutResult> {
    if (isProduction) {
      throw new Error('No payment provider configured — refusing to send a payout');
    }
    // Settles immediately, so a local walkthrough reaches PAID without anyone
    // having to fake a webhook. Tests that need a refusal or a hang spy on this
    // method directly, the way the deposit tests spy on getPayment.
    const providerRef = `stub_payout_${input.requestId}`;
    this.payouts.set(input.requestId, { state: 'successful', providerRef, reason: null });
    return { state: 'sent', providerRef };
  }

  async getPayout(requestId: string): Promise<PayoutStatus | null> {
    return this.payouts.get(requestId) ?? null;
  }

  /**
   * Records an inbound payment that getPayment will then confirm.
   *
   * Not on the PaymentProvider interface: no real provider can be told that
   * money arrived. This exists so a developer can walk the deposit flow, and so
   * tests can drive it without stubbing fetch.
   */
  simulatePayment(params: {
    email: string;
    amountMinor: bigint;
    accountNumber?: string;
    providerRef?: string;
  }): ConfirmedPayment {
    const payment: ConfirmedPayment = {
      providerRef: params.providerRef ?? `stub_tnx_${randomUUID()}`,
      amountMinor: params.amountMinor,
      currency: 'NGN',
      customerEmail: params.email,
      accountNumber: params.accountNumber ?? null,
      paidAt: new Date(),
    };
    this.payments.set(payment.providerRef, payment);
    return payment;
  }
}

/**
 * Typed as the interface rather than the class, so tests can vi.spyOn this
 * singleton the way auth.test.ts does with emailService.
 *
 * env.ts guarantees the Klasha vars are all set or all empty, so this one check
 * is enough to decide.
 */
export const paymentProvider: PaymentProvider = env.KLASHA_PUBLIC_KEY
  ? new KlashaPaymentProvider(
      env.KLASHA_BASE_URL,
      env.KLASHA_PUBLIC_KEY,
      env.KLASHA_ENCRYPTION_KEY,
      env.KLASHA_ACCOUNT_EMAIL,
      env.KLASHA_ACCOUNT_PASSWORD,
      env.KLASHA_BUSINESS_ID,
    )
  : new StubPaymentProvider();

if (isProduction && !env.KLASHA_PUBLIC_KEY) {
  logger.warn(
    'No payment provider configured — nobody can fund a wallet, so nobody can invest.',
  );
}
