import type { CookieOptions, Response } from 'express';
import { env, isProduction } from '../config/env';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../services/token.service';

export const ACCESS_COOKIE = 'tw_access';
export const REFRESH_COOKIE = 'tw_refresh';

/**
 * Both tokens live in httpOnly cookies rather than localStorage so that (a) XSS
 * cannot read them and (b) Next.js middleware and Server Components can read the
 * session while rendering on the server.
 *
 * SameSite=Lax is safe here because tradewave.com and api.tradewave.com are the
 * same site. CSRF is covered separately by the Origin check in middleware.
 */
function baseOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: maxAgeSeconds * 1000,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseOptions(ACCESS_TOKEN_TTL_SECONDS), path: '/' });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseOptions(REFRESH_TOKEN_TTL_SECONDS),
    // Scoped so the long-lived token is only ever sent to the refresh endpoint.
    path: '/api/v1/auth',
  });
}

export function clearAuthCookies(res: Response): void {
  const shared = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
  res.clearCookie(ACCESS_COOKIE, { ...shared, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...shared, path: '/api/v1/auth' });
}
