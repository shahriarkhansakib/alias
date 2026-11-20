import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
