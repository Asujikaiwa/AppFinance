/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // tax-core ships as TS source; let Next transpile it from the workspace
  transpilePackages: ['@appfinance/tax-core'],
  experimental: {
    // Allow importing from the monorepo root
    externalDir: true,
  },
};

export default nextConfig;
