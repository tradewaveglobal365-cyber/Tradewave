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
  images: {
    // Marketing photography is remote placeholder content until the client
    // supplies real property shots. The same host serves the seeded property
    // images in tradewave-api/prisma/seed.ts.
    remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }],
  },
  async rewrites() {
    if (!API_ORIGIN) return [];
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
