#!/usr/bin/env node
// One-time install for the three systems: npm deps, System 2's Python venv and migrations,
// System 3's database migrations. Copies any missing .env file from its .env.example.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isWindows, pythonForS2, ROOT } from './systems.mjs';

const failures = [];

function run(label, cmd, cwd) {
  console.log(
    `\n\u001b[36m[setup] ${label}\u001b[0m\n  ${cmd}  (in ${path.relative(ROOT, cwd) || '.'})`,
  );
  const result = spawnSync(cmd, { cwd, shell: true, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(
      `\u001b[31m[setup] ${label} failed (exit ${result.status}). Fix it and re-run pnpm setup:systems.\u001b[0m`,
    );
    failures.push(label);
    return false;
  }
  return true;
}

function copyEnv(dir, example, target) {
  const from = path.join(ROOT, dir, example);
  const to = path.join(ROOT, dir, target);
  if (fs.existsSync(from) && !fs.existsSync(to)) {
    fs.copyFileSync(from, to);
    console.log(
      `[setup] created ${path.join(dir, target)} from ${example} — fill in the real values`,
    );
  }
}

copyEnv('systems/s1-client-intake', '.env.example', '.env.local');
copyEnv('systems/s2-ad-creative/backend', '.env.example', '.env');
copyEnv('systems/s2-ad-creative/frontend', '.env.example', '.env.local');
copyEnv('systems/s3-publish/Backend', '.env.example', '.env');
copyEnv('systems/s3-publish/Frontend', '.env.example', '.env');

const s1 = path.join(ROOT, 'systems/s1-client-intake');
const s2b = path.join(ROOT, 'systems/s2-ad-creative/backend');
const s2f = path.join(ROOT, 'systems/s2-ad-creative/frontend');
const s3b = path.join(ROOT, 'systems/s3-publish/Backend');
const s3f = path.join(ROOT, 'systems/s3-publish/Frontend');

run('System 1: npm install', 'npm install --legacy-peer-deps', s1);

if (!fs.existsSync(path.join(s2b, 'venv'))) {
  run('System 2: create Python venv', `${isWindows ? 'python' : 'python3'} -m venv venv`, s2b);
}
run('System 2: pip install', `${pythonForS2()} -m pip install -r requirements.txt`, s2b);
run('System 2: database migrations', `${pythonForS2()} -m alembic upgrade head`, s2b);
run('System 2 web: npm install', 'npm install', s2f);

run('System 3 API: npm install', 'npm install', s3b);
run('System 3 API: database migrations', 'npx ts-node src/db/migrate.ts', s3b);
run('System 3 web: npm install', 'npm install', s3f);

if (failures.length > 0) {
  console.error(
    `\n\u001b[31m[setup] ${failures.length} step(s) failed:\u001b[0m\n  - ${failures.join('\n  - ')}`,
  );
  process.exit(1);
}
console.log('\n[setup] Done. Start everything with: pnpm dev:all  →  http://localhost:3000');
