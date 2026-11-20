// Shared description of every process behind the Alias gateway.
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const isWindows = process.platform === 'win32';

const s2Backend = path.join(ROOT, 'systems/s2-ad-creative/backend');
const venvPython = path.join(s2Backend, 'venv', isWindows ? 'Scripts/python.exe' : 'bin/python');

export function pythonForS2() {
  return fs.existsSync(venvPython) ? `"${venvPython}"` : isWindows ? 'python' : 'python3';
}

/** Every service, its internal port and how to start it. Only :3000 is ever opened by users. */
export const services = [
  {
    id: 'platform',
    label: 'platform',
    color: 36,
    port: 3000,
    cwd: ROOT,
    cmd: 'pnpm dev',
    needs: 'node_modules',
  },
  {
    id: 's1',
    label: 's1-intake',
    color: 35,
    port: 3005,
    cwd: path.join(ROOT, 'systems/s1-client-intake'),
    cmd: 'npm run dev -- -p 3005',
    needs: 'node_modules',
  },
  {
    id: 's2-api',
    label: 's2-api',
    color: 33,
    port: 8000,
    cwd: s2Backend,
    cmd: () => `${pythonForS2()} -m uvicorn app.main:app --reload --port 8000`,
    needs: 'venv',
  },
  {
    id: 's2-web',
    label: 's2-studio',
    color: 32,
    port: 3001,
    cwd: path.join(ROOT, 'systems/s2-ad-creative/frontend'),
    cmd: 'npm run dev -- -p 3001',
    needs: 'node_modules',
  },
  {
    id: 's3-api',
    label: 's3-api',
    color: 34,
    port: 3002,
    cwd: path.join(ROOT, 'systems/s3-publish/Backend'),
    cmd: 'npm run dev',
    needs: 'node_modules',
  },
  {
    id: 's3-web',
    label: 's3-publish',
    color: 31,
    port: 5173,
    cwd: path.join(ROOT, 'systems/s3-publish/Frontend'),
    cmd: 'npm run dev',
    needs: 'node_modules',
  },
];

export function isInstalled(service) {
  return fs.existsSync(path.join(service.cwd, service.needs));
}
