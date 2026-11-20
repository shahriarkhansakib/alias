// Vitest config for the repo-level scripts in this folder. Vitest is installed in apps/api, so the
// tests run with that binary (`pnpm test:scripts`) and use Vitest globals instead of importing it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  root: path.resolve(here, '..'),
  test: {
    name: 'scripts',
    environment: 'node',
    globals: true,
    include: ['scripts/**/*.test.mjs'],
    testTimeout: 30000,
  },
};
