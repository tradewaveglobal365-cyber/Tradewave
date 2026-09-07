import { cookies } from 'next/headers';
import { API_URL } from './api';
import type { PublicUser } from './types';

/**
 * Reads the current user on the server.
 *
 * Server Components cannot use the browser's automatic cookie handling, so the
 * incoming Cookie header is forwarded explicitly. Returns null rather than
 * throwing: an expired session is an ordinary state, not an error.
 */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { Cookie: cookieHeader },
      // Never serve a cached identity — it would leak between users.
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user: PublicUser };
    return body.user;
  } catch {
    // API unreachable during render; treat as signed out rather than 500ing.
    return null;
  }
}
