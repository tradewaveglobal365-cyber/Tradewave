import { cookies } from 'next/headers';
import { API_URL } from './api';
import type { Cents } from './money';

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
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getWallet(): Promise<WalletSummary | null> {
  return authedGet<WalletSummary>('/wallet');
}

/**
 * The user's deposit account details.
 *
 * Returns null for an unverified user — the API answers 403 KYC_REQUIRED, which
 * is a real answer rather than a failure. Callers render the verification
 * prompt instead of an error.
 */
export async function getDepositAccount(): Promise<DepositAccount | null> {
  return authedGet<DepositAccount>('/wallet/deposit-account');
}
