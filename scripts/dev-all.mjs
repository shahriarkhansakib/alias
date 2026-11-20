#!/usr/bin/env node
// Starts the platform and all three systems with one command.
// Users only open http://localhost:3000; apps/web forwards /intake, /studio, /publish and /svc/*.
//
//   pnpm dev:all                 start everything that is installed
//   pnpm dev:all --only=s1,s3-api  start a subset (ids: platform, s1, s2-api, s2-web, s3-api, s3-web)
import { spawn, spawnSync } from 'node:child_process';
import { isInstalled, isWindows, services } from './systems.mjs';

const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
const selected = services.filter((s) => !only || only.has(s.id) || s.id === 'platform');

const children = [];
const width = Math.max(...selected.map((s) => s.label.length));

function prefix(service, chunk) {
  const tag = `\u001b[${service.color}m${service.label.padEnd(width)}\u001b[0m |`;
  return chunk
    .toString()
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => `${tag} ${line}`)
    .join('\n');
}

for (const service of selected) {
  if (!isInstalled(service)) {
    console.warn(
      `\u001b[33m[dev:all] skipping ${service.label}: ${service.needs} missing in ${service.cwd}. Run: pnpm setup:systems\u001b[0m`,
    );
    continue;
  }
  const cmd = typeof service.cmd === 'function' ? service.cmd() : service.cmd;
  const child = spawn(cmd, {
    cwd: service.cwd,
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  child.stdout.on('data', (d) => console.log(prefix(service, d)));
  child.stderr.on('data', (d) => console.error(prefix(service, d)));
  child.on('exit', (code) => console.log(prefix(service, `exited with code ${code}`)));
  children.push(child);
  console.log(`[dev:all] started ${service.label} (internal port ${service.port})`);
}

console.log('\n[dev:all] Open http://localhost:3000 — everything is served from there.\n');

function shutdown() {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWindows) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      child.kill('SIGTERM');
    }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
