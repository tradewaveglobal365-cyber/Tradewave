import { cookies } from 'next/headers';
import { API_URL } from './api';
import type { Cents } from './money';
import type { ApiErrorBody } from './types';

export interface LedgerEntry {
  id: string;
  type: string;
  amountCents: Cents;
  balanceAfterCents: Cents;
  description: string;
  createdAt: string;
}

export interface WalletSummary {
  balanceCents: Cents;
  entries: LedgerEntry[];
}

/** The naira account a user transfers into. Null until identity is verified. */
export interface DepositAccount {
  accountNumber: string;
  accountName: string;
  bankName: string;
  currency: string;
  /** Kobo per dollar, or null when no rate has been published. */
  rateMinorPerUnit: string | null;
  exampleKoboForHundredUsd: string | null;
}

async function authedGet<T>(path: string): Promise<T | null> {
  const result = await authedGetResult<T>(path);
  return result.ok ? result.body : null;
}

/**
 * The same read, but saying WHY it failed.
 *
 * authedGet collapses every outcome into null, which is fine when the caller
 * treats absence and failure identically. It is not fine when the two mean
 * opposite things to the user — see getDepositAccount, where a 403 means
 * "verify your identity" and a 503 means "our payment provider is down", and
 * showing the first message for the second tells a verified investor they are
 * not verified.
 */
async function authedGetResult<T>(
  path: string,
): Promise<{ ok: true; body: T } | { ok: false; status: number; code: string; message: string }> {
  const cookieHeader = (await cookies()).toString();
  // 401 is the honest status for "no session", and it keeps this on one path.
  if (!cookieHeader) return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: '' };

  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.ok) return { ok: true, body: (await res.json()) as T };

    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    return {
      ok: false,
      status: res.status,
      code: body.error?.code ?? 'UNKNOWN',
      message: body.error?.message ?? '',
    };
  } catch {
    // The API was unreachable. Status 0 rather than a guess at one.
    return { ok: false, status: 0, code: 'NETWORK', message: '' };
  }
}

export async function getWallet(): Promise<WalletSummary | null> {
  return authedGet<WalletSummary>('/wallet');
}

/**
 * Why the funding panel is or is not showing.
 *
 * Three outcomes, because there are three things to say. This used to be
 * `DepositAccount | null`, and the wallet page read the null as "not verified"
 * — so a verified investor whose account we simply could not issue was told to
 * go and verify an identity they had already verified. That is the single
 * worst thing this screen can say, and it was said for every provider failure,
 * every timeout and every 500.
 */
export type DepositAccountState =
  | { state: 'ok'; account: DepositAccount }
  | { state: 'kyc_required' }
  | { state: 'unavailable'; message: string };

export async function getDepositAccount(): Promise<DepositAccountState> {
  const result = await authedGetResult<DepositAccount>('/wallet/deposit-account');
  if (result.ok) return { state: 'ok', account: result.body };

  // Only an explicit 403 means the identity check is what is missing.
  if (result.status === 403) return { state: 'kyc_required' };

  return {
    state: 'unavailable',
    // The API's own wording when it gave one — depositsUnavailable() already
    // explains itself better than anything this layer could invent.
    message:
      result.message ||
      'We could not set up your funding account just now. Please try again shortly.',
  };
}

export interface Bank {
  code: string;
  name: string;
}

export interface PayoutAccount {
  bankCode: string;
  bankName: string;
  /** Masked — the full number never leaves the API. */
  accountNumberMasked: string;
  accountName: string;
  nameResolved: boolean;
  updatedAt: string;
}

/**
 * The banks a payout can be sent to, or null when the list could not be loaded.
 *
 * The null is the point. Coalescing a failed request to [] renders a dropdown
 * containing nothing but "Choose a bank", which looks like a bug in the form
 * rather than a provider that is unreachable — and gives the user nothing to
 * act on. Callers render the two cases differently.
 */
export async function getBanks(): Promise<Bank[] | null> {
  const body = await authedGet<{ banks: Bank[] }>('/wallet/banks');
  if (!body || !Array.isArray(body.banks) || body.banks.length === 0) return null;
  return body.banks;
}

export async function getPayoutAccount(): Promise<PayoutAccount | null> {
  const body = await authedGet<{ account: PayoutAccount | null }>('/wallet/payout-account');
  return body?.account ?? null;
}
