import { cookies } from 'next/headers';
import { API_URL } from './api';

export interface WalletSummary {
  balanceCents: string;
}

/**
 * Reads the wallet balance server-side.
 *
 * GET /wallet does not exist yet, so this returns null and callers fall back to
 * zero. Written now rather than later so the sidebar picks up a real balance the
 * moment the endpoint lands, with no component changes.
 */
export async function getWallet(): Promise<WalletSummary | null> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  try {
    const res = await fetch(`${API_URL}/wallet`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as WalletSummary;
  } catch {
    return null;
  }
}
