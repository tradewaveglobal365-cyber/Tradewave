import { cookies } from 'next/headers';
import { API_URL } from './api';
import type { Fils } from './money';

export interface Holding {
  id: string;
  property: { slug: string; title: string; area: string; city: string; image: string | null };
  principalFils: Fils;
  accruedFils: Fils;
  currentValueFils: Fils;
  projectedTotalFils: Fils;
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
  totalInvestedFils: Fils;
  currentValueFils: Fils;
  accruedFils: Fils;
  holdings: Holding[];
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
