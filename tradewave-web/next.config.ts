import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Marketing photography is remote placeholder content until the client
    // supplies real property shots. The same host serves the seeded property
    // images in tradewave-api/prisma/seed.ts.
    remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }],
  },
};

export default nextConfig;
