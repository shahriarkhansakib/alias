import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import type { NextConfig } from 'next';

const rootEnvPath = path.resolve(import.meta.dirname, '../../.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: false });
}

/**
 * Internal addresses of the three systems. Users never open these; apps/web on :3000
 * forwards to them after src/proxy.ts has checked the session and role.
 */
const systems = {
  intake: (process.env.ALIAS_S1_INTERNAL_URL ?? 'http://127.0.0.1:3005').replace(/\/+$/, ''),
  studio: (process.env.ALIAS_S2_WEB_INTERNAL_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, ''),
  creativeApi: (process.env.ALIAS_S2_API_INTERNAL_URL ?? 'http://127.0.0.1:8000').replace(
    /\/+$/,
    '',
  ),
  publish: (process.env.ALIAS_S3_WEB_INTERNAL_URL ?? 'http://127.0.0.1:5173').replace(/\/+$/, ''),
  publishingApi: (process.env.ALIAS_S3_API_INTERNAL_URL ?? 'http://127.0.0.1:3002').replace(
    /\/+$/,
    '',
  ),
};

const nextConfig: NextConfig = {
  transpilePackages: ['@alias/contracts'],
  experimental: {
    // AI agent calls behind the gateway can take longer than the 30 s default.
    proxyTimeout: 120_000,
  },
  async rewrites() {
    return {
      // beforeFiles: these win over app routes such as app/api/[...path].
      beforeFiles: [
        { source: '/intake', destination: `${systems.intake}/intake` },
        { source: '/intake/:path*', destination: `${systems.intake}/intake/:path*` },
        { source: '/studio', destination: `${systems.studio}/studio` },
        { source: '/studio/:path*', destination: `${systems.studio}/studio/:path*` },
        { source: '/publish', destination: `${systems.publish}/publish/` },
        { source: '/publish/:path*', destination: `${systems.publish}/publish/:path*` },
        { source: '/svc/creative/:path*', destination: `${systems.creativeApi}/:path*` },
        { source: '/svc/publishing/:path*', destination: `${systems.publishingApi}/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
