// Vitest config for the repo-level scripts in this folder, run from the repository root with the
// root devDependency `vitest` (`pnpm test:scripts`). The tests use Vitest globals
// (describe, it, expect, beforeEach, afterEach).
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
