import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  serverExternalPackages: ['pdf-parse'],
  // Allow CI/local verification builds to run alongside a live dev server.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Retired Applicants pages now live in Lead Pipeline intake and the Import Center.
  async redirects() {
    return [
      { source: '/applicants/import', destination: '/leads/import', permanent: true },
      { source: '/applicants/:path*', destination: '/leads', permanent: true },
      { source: '/personal/:path*', destination: '/leads', permanent: true },
      { source: '/personal', destination: '/leads', permanent: true },
      { source: '/commercial/:path*', destination: '/leads', permanent: true },
    ];
  },
};

export default nextConfig;
