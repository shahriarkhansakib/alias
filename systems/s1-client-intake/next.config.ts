import type { NextConfig } from "next";

// Served behind the Alias gateway at http://localhost:3000/intake (see apps/web/next.config.ts).
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/intake";

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
  experimental: {
    cpus: 1,
  },
  async redirects() {
    return [
      {
        source: "/campaign/new.",
        destination: "/campaign/new",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
