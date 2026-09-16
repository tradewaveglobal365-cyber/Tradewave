import { NextResponse, type NextRequest } from 'next/server';

const ACCESS_COOKIE = 'tw_access';
const REFRESH_COOKIE = 'tw_refresh';
const REF_COOKIE = 'tw_ref';
const REF_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/properties',
  '/portfolio',
  '/wallet',
  '/referrals',
  '/documents',
  '/settings',
  '/verify-identity',
  '/admin',
];
const AUTH_PAGES = ['/login', '/signup', '/forgot-password'];

const REFERRAL_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

const API_BASE = process.env.API_ORIGIN
  ? `${process.env.API_ORIGIN}/api/v1`
  : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001/api/v1');

/**
 * Reads exp out of the access JWT without verifying it.
 *
 * Verification is the API’s job and happens on every call. All this decides is
 * whether a refresh round trip is worth making, so a forged token costs one
 * wasted request and nothing more.
 */
function accessTokenIsFresh(token: string | undefined): boolean {
  if (!token) return false;
  const payload = token.split('.')[1];
  if (!payload) return false;

  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    if (typeof json.exp !== 'number') return false;
    // A minute of headroom, so a token cannot expire midway through a render
    // that has already begun.
    return json.exp * 1000 - Date.now() > 60_000;
  } catch {
    return false;
  }
}

/** "name=value; Path=/; HttpOnly" → ["name", "value"] */
function nameAndValue(setCookie: string): [string, string] | null {
  const pair = setCookie.split(';', 1)[0];
  if (!pair) return null;
  const eq = pair.indexOf('=');
  if (eq < 1) return null;
  return [pair.slice(0, eq).trim(), pair.slice(eq + 1)];
}

/**
 * Trades the refresh token for a new access token.
 *
 * The access token lives fifteen minutes, the refresh token thirty days, and
 * until now nothing ever called /auth/refresh — so every user was signed out a
 * quarter of an hour after logging in, and anyone who stepped away to verify
 * their identity on the provider’s site came back to a login screen.
 *
 * This has to happen here rather than during render: Server Components can read
 * cookies but cannot set them, so a refresh performed while rendering could
 * never be persisted and would repeat on every single request.
 *
 * Returns the Set-Cookie headers the API issued, or null when nothing was done.
 */
async function refreshSession(req: NextRequest): Promise<string[] | null> {
  if (accessTokenIsFresh(req.cookies.get(ACCESS_COOKIE)?.value)) return null;

  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  // No refresh token means genuinely signed out, not merely expired.
  if (!refresh) return null;

  // Never rotate on a prefetch: the browser fires those for links the user may
  // never click, and each would spend a rotation on a navigation that never
  // happens.
  if (req.headers.get('next-router-prefetch') === '1') return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `${REFRESH_COOKIE}=${refresh}` },
      cache: 'no-store',
    });
    // 401 is a real end of session — expired, revoked, or reuse detected. Let
    // the redirect below deal with it.
    if (!res.ok) return null;
    const issued = res.headers.getSetCookie();
    return issued.length > 0 ? issued : null;
  } catch {
    // API unreachable. Carry on rather than failing a page that may not even
    // need a session.
    return null;
  }
}

export default async function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // ── Referral capture ──────────────────────────────────────────────────────
  // The code is persisted to a cookie and stripped from the URL, so a visitor
  // who lands on a referral link and then browses around still carries their
  // referrer to the signup form — and doesn't accidentally reshare the link
  // with their own code attached.
  const ref = searchParams.get('ref')?.trim().toUpperCase();
  if (ref && REFERRAL_CODE.test(ref)) {
    const url = req.nextUrl.clone();
    url.searchParams.delete('ref');
    const res = NextResponse.redirect(url);
    res.cookies.set(REF_COOKIE, ref, {
      // Readable by the signup form, so NOT httpOnly. It is a marketing
      // attribution hint, never an authorisation input — the API re-resolves it.
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: REF_MAX_AGE,
      path: '/',
    });
    return res;
  }

  // ── Session refresh ───────────────────────────────────────────────────────
  const issued = await refreshSession(req);

  // ── Route protection ──────────────────────────────────────────────────────
  // Presence-only check. The cookie is a signed JWT this middleware cannot
  // verify without the secret (which belongs to the API, not the web app), so
  // this is a redirect optimisation — the API is the real authority and rejects
  // any forged or expired token on the actual data call.
  const hasSession =
    issued !== null || req.cookies.has(ACCESS_COOKIE) || req.cookies.has(REFRESH_COOKIE);

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (isProtected && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return withCookies(NextResponse.redirect(url), issued);
  }

  // Already signed in? Skip the auth screens.
  if (hasSession && AUTH_PAGES.includes(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return withCookies(NextResponse.redirect(url), issued);
  }

  if (!issued) return NextResponse.next();

  // The new tokens have to reach THIS render, not just the next one. Server
  // Components read the request cookies, so a refresh that only wrote response
  // cookies would still bounce the user to sign in and fix itself one
  // navigation too late.
  const jar = new Map<string, string>();
  for (const cookie of req.cookies.getAll()) jar.set(cookie.name, cookie.value);
  for (const raw of issued) {
    const parsed = nameAndValue(raw);
    if (parsed) jar.set(parsed[0], parsed[1]);
  }

  const headers = new Headers(req.headers);
  headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));

  return withCookies(NextResponse.next({ request: { headers } }), issued);
}

/** Passes the API's Set-Cookie headers through verbatim, flags and all. */
function withCookies(res: NextResponse, issued: string[] | null): NextResponse {
  for (const raw of issued ?? []) res.headers.append('set-cookie', raw);
  return res;
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets. `ref` capture has to
     * work on any landing page, so this cannot be narrowed to /signup.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
