import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  serverExternalPackages: ['pdf-parse'],
  // Allow CI/local verification builds to run alongside a live dev server.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
