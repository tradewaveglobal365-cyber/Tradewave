import { cookies } from 'next/headers';
import { API_URL } from './api';

export interface FxRateView {
  baseCurrency: string;
  quoteCurrency: string;
  /** Kobo per dollar, as a string. Null when no rate has ever been published. */
  minorPerUnit: string | null;
  effectiveAt: string | null;
}

export interface AdminDeposit {
  id: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'ABANDONED';
  providerRef: string;
  sourceAmountMinor: string | null;
  sourceCurrency: string;
  amountCents: string;
  rateMinorPerUnit: string | null;
  paidAt: string | null;
  createdAt: string;
  user: { id: string; email: string; firstName: string; lastName: string };
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

export async function getFxRate(): Promise<FxRateView | null> {
  return authedGet<FxRateView>('/fx/rate');
}

export async function getAdminDeposits(): Promise<AdminDeposit[]> {
  const body = await authedGet<{ deposits: AdminDeposit[] }>('/admin/deposits');
  return body?.deposits ?? [];
}
