import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import type { NextConfig } from 'next';

const rootEnvPath = path.resolve(import.meta.dirname, '../../.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: false });
}

const nextConfig: NextConfig = {
  transpilePackages: ['@alias/contracts'],
};

export default nextConfig;
