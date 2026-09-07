import { cookies } from 'next/headers';
import { API_URL } from './api';
import type { KycStatusView } from './types';

/**
 * Reads identity-verification state server-side.
 *
 * Same shape as getWallet: forwards the Cookie header explicitly because Server
 * Components have no automatic cookie jar, and returns null rather than throwing
 * so an unreachable API renders as "not started" instead of a 500.
 */
export async function getKycStatus(): Promise<KycStatusView | null> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  try {
    const res = await fetch(`${API_URL}/kyc/me`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as KycStatusView;
  } catch {
    return null;
  }
}
