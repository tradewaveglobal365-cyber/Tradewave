import { cookies } from 'next/headers';
import { API_URL } from './api';
import type { Cents } from './money';

export interface Holding {
  id: string;
  property: { slug: string; title: string; area: string; city: string; image: string | null };
  principalCents: Cents;
  accruedCents: Cents;
  currentValueCents: Cents;
  projectedTotalCents: Cents;
  annualReturnBps: number;
  termMonths: number;
  investedAt: string;
  maturesAt: string;
  progress: number;
  isMatured: boolean;
  status: string;
}

export interface Portfolio {
  holdingCount: number;
  totalInvestedCents: Cents;
  currentValueCents: Cents;
  accruedCents: Cents;
  holdings: Holding[];
  /**
   * The API's own clock, ISO. The portfolio ticks accrual up live in the
   * browser, and a device with a wrong clock would otherwise show a figure we
   * would not pay — so the client works from the offset against this.
   */
  serverTime?: string;
}

export async function getPortfolio(): Promise<Portfolio | null> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  try {
    const res = await fetch(`${API_URL}/portfolio`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as Portfolio;
  } catch {
    return null;
  }
}
