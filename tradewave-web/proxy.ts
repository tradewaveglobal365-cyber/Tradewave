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
];
const AUTH_PAGES = ['/login', '/signup', '/forgot-password'];

const REFERRAL_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

export default function proxy(req: NextRequest) {
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

  // ── Route protection ──────────────────────────────────────────────────────
  // Presence-only check. The cookie is a signed JWT this middleware cannot
  // verify without the secret (which belongs to the API, not the web app), so
  // this is a redirect optimisation — the API is the real authority and rejects
  // any forged or expired token on the actual data call.
  const hasSession =
    req.cookies.has(ACCESS_COOKIE) || req.cookies.has(REFRESH_COOKIE);

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (isProtected && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // Already signed in? Skip the auth screens.
  if (hasSession && AUTH_PAGES.includes(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
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
