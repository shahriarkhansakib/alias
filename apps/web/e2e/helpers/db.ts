import { execFileSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../');

function runPnpm(args: string[]): void {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const finalArgs = process.platform === 'win32' ? ['/c', 'pnpm.cmd', ...args] : args;

  execFileSync(command, finalArgs, {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });
}

export function resetDatabaseForE2e(): void {
  runPnpm(['--filter', '@alias/api', 'db:reset:schema']);
}

export function bootstrapSuperAdminForE2e(email: string): void {
  runPnpm(['--filter', '@alias/api', 'bootstrap:admin', '--', '--email', email]);
}
