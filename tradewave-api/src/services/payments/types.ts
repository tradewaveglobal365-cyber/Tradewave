/**
 * The deposit-collection contract. Deliberately provider-neutral: no vendor
 * appears in this file, so replacing one is a new class in ./ and nothing else
 * in the codebase moves. The same shape the KYC driver uses, for the same
 * reason — the last provider was swapped out mid-build.
 *
 * Shaped around DEDICATED BANK ACCOUNTS. The provider issues one permanent
 * naira account per user; the user transfers into it from their own banking app
 * whenever they like. That has two consequences the rest of this codebase has
 * to respect:
 *
 *   1. No amount is agreed in advance. Money simply arrives, and the deposit
 *      row is created on receipt rather than at the start of a checkout.
 *   2. There is no return redirect and no "session". The user never leaves the
 *      app, so nothing can be reconciled from a page they land back on.
 */

export interface CreateDepositAccountInput {
  /** Our User.id. Not sent to the provider — it keys on email — but logged. */
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface DepositAccountDetails {
  /** The vendor's own id for the account, when it exposes one. */
  providerRef: string | null;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode: string | null;
  currency: string;
}

/**
 * A confirmed inbound payment, as the PROVIDER reports it on a direct read.
 *
 * Never built from a webhook body. See KlashaPaymentProvider.parseWebhook for
 * why that distinction is the security boundary in this integration.
 */
export interface ConfirmedPayment {
  /** The vendor's transaction reference. Our idempotency key. */
  providerRef: string;
  /** Minor units of the currency actually received — kobo, for naira. */
  amountMinor: bigint;
  currency: string;
  /**
   * Who the money is for. The provider identifies a dedicated account by the
   * email it was created with, so this is the join key back to a User.
   */
  customerEmail: string | null;
  /** The destination account, when the provider reports it. Preferred over email. */
  accountNumber: string | null;
  paidAt: Date | null;
}

export interface PaymentProvider {
  /** Identifies rows this driver wrote. Persisted on DepositAccount.provider. */
  readonly name: string;

  /**
   * Issues the user's permanent deposit account, or returns the existing one.
   *
   * Called once per user and then cached in our own database: the details never
   * change, and a wallet page that cannot render because the provider is slow is
   * worse than one rendering details we already hold.
   */
  createDepositAccount(input: CreateDepositAccountInput): Promise<DepositAccountDetails>;

  /**
   * Asks the provider to confirm one transaction, by its reference.
   *
   * This is the ONLY source a credit may be built from. Returns null when the
   * provider has no record of the reference or reports it as anything other
   * than successful.
   */
  getPayment(providerRef: string): Promise<ConfirmedPayment | null>;

  /**
   * Extracts the transaction reference from a webhook body — and nothing else.
   *
   * Deliberately narrow. The return type carries no amount and no account,
   * because a webhook is not evidence of a payment: it is a prompt to go and
   * ask. Everything that moves money comes back from getPayment().
   *
   * Returns null when the body carries no usable reference.
   */
  parseWebhookReference(body: unknown): string | null;

  /**
   * Lists recent transactions, for the reconciliation sweep.
   *
   * Needed because the webhook is the only push we get and it is unauthenticated
   * — so it can be lost, and it must never be the sole path by which money is
   * credited. Returns confirmed payments only.
   */
  listRecentPayments(limit: number): Promise<ConfirmedPayment[]>;
}
