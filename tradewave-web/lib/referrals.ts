import { cookies } from 'next/headers';
import { API_URL } from './api';
import type { ReferralList, ReferralSummary } from './types';

async function serverFetch<T>(path: string): Promise<T | null> {
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

export const getReferralSummary = () => serverFetch<ReferralSummary>('/referrals/me');

export const getReferralList = (page = 1) =>
  serverFetch<ReferralList>(`/referrals/list?page=${page}&perPage=20`);
