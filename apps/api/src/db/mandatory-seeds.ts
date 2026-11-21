import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { seedSystemRoles } from './seed-roles.js';

/**
 * Data the application cannot run without, inserted by `db:migrate`, `db:reset:schema` and
 * `db:reset`. Every entry must be idempotent (safe to run on every migrate).
 *
 * Demo or sample data (test accounts, example campaigns) never goes here; it belongs in a
 * separate, opt-in seed command.
 */
export interface MandatorySeed {
  /** Shown in command output, e.g. "✓ Seeded system roles and permissions". */
  name: string;
  run(db: NodePgDatabase<Record<string, unknown>>): Promise<void>;
}

export const MANDATORY_SEEDS: readonly MandatorySeed[] = [
  { name: 'system roles and permissions', run: seedSystemRoles },
];

/** Runs every mandatory seed in order; `onSeeded` is called after each one. */
export async function seedMandatoryData(
  db: NodePgDatabase<Record<string, unknown>>,
  onSeeded?: (name: string) => void,
): Promise<void> {
  for (const seed of MANDATORY_SEEDS) {
    await seed.run(db);
    onSeeded?.(seed.name);
  }
}
