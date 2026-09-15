import type { NextConfig } from "next";

/**
 * `API_ORIGIN` is the deployed API's origin (e.g. https://tradewave-api.onrender.com).
 * When it is set, /api/* is rewritten to it server-side, so the browser only ever
 * talks to this Vercel origin. That keeps the session cookie first-party — the API
 * sets it SameSite=Lax, which a browser would otherwise drop as third-party when
 * the frontend and API sit on different domains (vercel.app vs onrender.com).
 *
 * Unset locally, where the browser calls http://localhost:4001 directly and
 * localhost is already same-site.
 */
const API_ORIGIN = process.env.API_ORIGIN;

const nextConfig: NextConfig = {
  /**
   * How long a visited route stays in the client router cache.
   *
   * Every page in the dashboard and admin is dynamic and fetches from the API
   * on the server, which on Render's free tier costs about a second even for a
   * response that does no work. The default for dynamic segments is 0, so
   * clicking back to a tab you left ten seconds ago pays that again.
   *
   * 30s makes moving between tabs instant on the way back. Mutations are not
   * affected: publishing a listing, releasing a deposit and setting a rate all
   * call router.refresh(), which invalidates this. The residual staleness is
   * another admin's change not appearing for half a minute — acceptable, and a
   * reload always shows the truth.
   */
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },
  images: {
    // Marketing photography is remote placeholder content until the client
    // supplies real property shots. The same host serves the seeded property
    // images in tradewave-api/prisma/seed.ts.
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      // Listing photographs uploaded through the admin live in Supabase
      // Storage. The dashboard card uses a plain <img> and needs nothing, but
      // the marketing card uses next/image and would refuse to render them.
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  async rewrites() {
    if (!API_ORIGIN) return [];
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
