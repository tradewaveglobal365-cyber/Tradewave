/**
 * The money-movement contract, both directions. Deliberately provider-neutral:
 * no vendor appears in this file, so replacing one is a new class in ./ and
 * nothing else in the codebase moves. The same shape the KYC driver uses, for
 * the same reason — the last provider was swapped out mid-build.
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

export interface Bank {
  code: string;
  name: string;
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
   * Classifies a webhook body — and extracts nothing else.
   *
   * Deliberately narrow. The return type carries no amount, because a webhook
   * is not evidence of anything: it is a prompt to go and ask. Everything that
   * moves money comes back from getPayment() or getPayout().
   *
   * It is typed as a UNION rather than a bare reference because one provider
   * URL receives every kind of event. Money coming in and money going out
   * arrive at the same endpoint, and telling them apart by shape alone is how
   * an outbound payout ends up credited to somebody's wallet.
   *
   * Returns null for anything unrecognised, which is the common case: providers
   * send event types we have no interest in.
   */
  parseWebhookEvent(body: unknown): WebhookEvent | null;

  /**
   * The banks a payout can be sent to, for the currency given.
   *
   * Fetched rather than bundled: a static list goes stale silently, and a
   * missing bank is a customer who cannot be paid.
   */
  listBanks(currency: string): Promise<Bank[]>;

  /**
   * Asks the bank who owns an account, for checking it against the verified
   * identity — the NIBSS name enquiry every Nigerian transfer screen runs
   * before you confirm.
   *
   * Returns null when the provider cannot answer: an unknown account number, or
   * a driver with no remote side. The caller then falls back to matching the
   * name the USER typed, which is a materially weaker check and is recorded as
   * such on the row.
   */
  resolveAccountName(bankCode: string, accountNumber: string): Promise<string | null>;

  /**
   * Lists recent transactions, for the reconciliation sweep.
   *
   * Needed because the webhook is the only push we get and it is unauthenticated
   * — so it can be lost, and it must never be the sole path by which money is
   * credited. Returns confirmed payments only.
   */
  listRecentPayments(limit: number): Promise<ConfirmedPayment[]>;

  /**
   * Sends money to a bank account.
   *
   * Returns rather than throws when the PROVIDER refuses, and throws when the
   * call itself fails. That distinction is the whole reason this returns a
   * union — see PayoutResult.
   */
  sendPayout(input: SendPayoutInput): Promise<PayoutResult>;

  /**
   * Where a payout stands, by OUR reference rather than theirs.
   *
   * Keyed on requestId because that is the only identifier we are guaranteed to
   * hold: the provider's own reference arrives in a response body we cannot
   * fully rely on, and in a webhook that may never come.
   *
   * Returns null when the provider has never heard of it.
   */
  getPayout(requestId: string): Promise<PayoutStatus | null>;
}

// ── Money going out ──────────────────────────────────────────────────────────

export interface SendPayoutInput {
  /** Our reference. Unique per withdrawal, and the key getPayout reads back. */
  requestId: string;
  /** Minor units of the destination currency — kobo, for naira. */
  amountMinor: bigint;
  currency: string;
  /** ISO 3166-1 alpha-2, e.g. 'NG'. */
  country: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  /** What the recipient sees on their statement. */
  description: string;
}

export type PayoutState = 'pending' | 'successful' | 'failed';

export interface PayoutStatus {
  state: PayoutState;
  /** The provider's own reference, when it gives one. */
  providerRef: string | null;
  /** Their words, on a failure. */
  reason: string | null;
}

/**
 * What came back from asking a provider to send money.
 *
 * Two outcomes, and a third that is NOT represented here on purpose.
 *
 *   'sent'    — they accepted it. It may still fail later; that is what
 *               getPayout and the webhook are for.
 *   'refused' — they rejected it outright. A bad account number, or an empty
 *               float. The money definitely did not move, so the caller can
 *               safely return it to the wallet.
 *
 * The third outcome is a THROWN error: a timeout, a dropped socket, a 502. That
 * one must not be a value here, because every value in this union is something
 * a caller can act on, and "we do not know whether the money left" is not. An
 * implementation that catches a timeout and returns 'refused' is how somebody
 * gets paid twice.
 */
export type PayoutResult =
  | { state: 'sent'; providerRef: string | null }
  | { state: 'refused'; reason: string };

// ── Webhooks ─────────────────────────────────────────────────────────────────

/**
 * A classified webhook.
 *
 * `kind` is load-bearing: it is what stops an outbound payout notification
 * being fed to the code that credits wallets. Nothing downstream may infer the
 * kind from any other field.
 */
export type WebhookEvent =
  | { kind: 'collection'; reference: string }
  | { kind: 'payout'; reference: string; state: PayoutState };
