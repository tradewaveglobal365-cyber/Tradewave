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
    // Site-wide rather than scoped to /api/v1/auth.
    //
    // The narrow path was better defence in depth, and it made silent refresh
    // impossible: Next middleware runs on /dashboard, the browser does not send
    // a cookie scoped to /api/v1/auth on that request, so the only code able to
    // set new cookies could not see the token it needed. The result was that
    // nothing ever refreshed and every user was signed out fifteen minutes
    // after logging in.
    //
    // The token stays httpOnly, Secure and SameSite=Lax, so widening the path
    // does not expose it to JavaScript or to cross-site requests. It does mean
    // it rides along on same-origin requests generally, so nothing on this
    // origin may log raw cookie headers.
    path: '/',
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
  // Both paths: '/' is what setAuthCookies writes now, '/api/v1/auth' is what
  // sessions created before that change still carry. Clearing only the current
  // one would leave older browsers holding a cookie that never goes away.
  res.clearCookie(REFRESH_COOKIE, { ...shared, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...shared, path: '/api/v1/auth' });
}
