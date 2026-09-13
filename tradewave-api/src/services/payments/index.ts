import { randomUUID } from 'node:crypto';
import { env, isProduction } from '../../config/env';
import { logger } from '../../lib/logger';
import { KlashaPaymentProvider } from './klasha';
import type {
  ConfirmedPayment,
  CreateDepositAccountInput,
  DepositAccountDetails,
  PaymentProvider,
} from './types';

export type { PaymentProvider, ConfirmedPayment, DepositAccountDetails } from './types';

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

  parseWebhookReference(body: unknown): string | null {
    if (typeof body !== 'object' || body === null) return null;
    const payload = body as { tnxRef?: unknown; data?: { tnxRef?: unknown } };
    const ref = payload.data?.tnxRef ?? payload.tnxRef;
    return typeof ref === 'string' && ref.length > 0 ? ref : null;
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
    )
  : new StubPaymentProvider();

if (isProduction && !env.KLASHA_PUBLIC_KEY) {
  logger.warn(
    'No payment provider configured — nobody can fund a wallet, so nobody can invest.',
  );
}
