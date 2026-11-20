import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

function findRootEnvPath(startDir: string): string | null {
  let current = startDir;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(current, '.env');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

const optionalNonEmptyString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  });

const booleanFlagSchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .optional()
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (value === 'true' || value === '1') {
      return true;
    }
    if (value === 'false' || value === '0') {
      return false;
    }
    return undefined;
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z
    .string('Missing: set it to your Postgres connection URL')
    .min(1, 'Missing: set it to your Postgres connection URL'),
  BETTER_AUTH_SECRET: z
    .string('Missing: set it to a random string of at least 32 characters')
    .min(32, 'Too short: use a random string of at least 32 characters'),
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  TRUSTED_ORIGINS: z.string().default('http://localhost:3000'),
  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_SECURE: booleanFlagSchema.transform((value) => value ?? false),
  SMTP_USER: optionalNonEmptyString,
  SMTP_PASS: optionalNonEmptyString,
  EMAIL_FROM: z.string().min(1).default('Alias <no-reply@alias.local>'),
  GOOGLE_CLIENT_ID: optionalNonEmptyString,
  GOOGLE_CLIENT_SECRET: optionalNonEmptyString,
  AUTH_RATE_LIMIT_ENABLED: booleanFlagSchema,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface AppEnvConfig {
  nodeEnv: 'development' | 'test' | 'production';
  apiPort: number;
  apiHost: string;
  databaseUrl: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  webOrigin: string;
  trustedOrigins: string[];
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser?: string;
  smtpPass?: string;
  emailFrom: string;
  googleClientId?: string;
  googleClientSecret?: string;
  authRateLimitEnabled: boolean;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

export const ENV_HINT =
  'Copy .env.example to .env in the repository root and fill in the values, or set the variables in your shell.';

/**
 * Turns a failed env validation into a short, readable report: one line per missing or invalid
 * variable (Zod's `prettifyError`), followed by a hint. No stack trace.
 */
export function formatEnvError(error: z.ZodError): string {
  const count = error.issues.length;
  return [
    `Invalid environment configuration (${count} ${count === 1 ? 'problem' : 'problems'}):`,
    '',
    z.prettifyError(error),
    '',
    ENV_HINT,
  ].join('\n');
}

export type ParseEnvResult = { ok: true; config: AppEnvConfig } | { ok: false; message: string };

/** Validates a set of environment variables without reading files or exiting. */
export function parseEnv(source: Record<string, string | undefined>): ParseEnvResult {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    return { ok: false, message: formatEnvError(result.error) };
  }
  return { ok: true, config: toAppEnvConfig(result.data) };
}

/**
 * Loads the root `.env` (without overriding variables already set), validates the environment
 * and returns the config. On invalid configuration it prints the report to stderr and exits
 * with code 1.
 */
export function loadEnv(overrides?: Partial<NodeJS.ProcessEnv>): AppEnvConfig {
  const rootEnvPath = findRootEnvPath(import.meta.dirname);
  if (rootEnvPath) {
    dotenv.config({ path: rootEnvPath, override: false, quiet: true });
  }

  const result = parseEnv({
    ...process.env,
    ...overrides,
  });
  if (!result.ok) {
    process.stderr.write(`${result.message}\n`);
    process.exit(1);
  }
  return result.config;
}

function toAppEnvConfig(parsed: z.output<typeof EnvSchema>): AppEnvConfig {
  const trustedOrigins = Array.from(
    new Set(
      parsed.TRUSTED_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  );

  if (trustedOrigins.length === 0) {
    trustedOrigins.push(new URL(parsed.WEB_ORIGIN).origin);
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    apiPort: parsed.API_PORT,
    apiHost: parsed.API_HOST,
    databaseUrl: parsed.DATABASE_URL,
    betterAuthSecret: parsed.BETTER_AUTH_SECRET,
    betterAuthUrl: parsed.BETTER_AUTH_URL,
    webOrigin: new URL(parsed.WEB_ORIGIN).origin,
    trustedOrigins,
    smtpHost: parsed.SMTP_HOST,
    smtpPort: parsed.SMTP_PORT,
    smtpSecure: parsed.SMTP_SECURE,
    smtpUser: parsed.SMTP_USER,
    smtpPass: parsed.SMTP_PASS,
    emailFrom: parsed.EMAIL_FROM,
    googleClientId: parsed.GOOGLE_CLIENT_ID,
    googleClientSecret: parsed.GOOGLE_CLIENT_SECRET,
    authRateLimitEnabled: parsed.AUTH_RATE_LIMIT_ENABLED ?? parsed.NODE_ENV === 'production',
    logLevel: parsed.LOG_LEVEL,
  };
}
