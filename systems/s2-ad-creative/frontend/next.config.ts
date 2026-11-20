import type { NextConfig } from "next";

// Served behind the Alias gateway at http://localhost:3000/studio (see apps/web/next.config.ts).
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/studio";

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
};

export default nextConfig;
