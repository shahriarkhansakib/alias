import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV_HINT, parseEnv } from './env.js';

const VALID = {
  DATABASE_URL: 'postgresql://alias:alias@localhost:5432/alias',
  BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters-long',
};

function errorMessage(source: Record<string, string | undefined>): string {
  const result = parseEnv(source);
  if (result.ok) throw new Error('expected the environment to be invalid');
  return result.message;
}

describe('env validation', () => {
  describe('happy paths', () => {
    it('accepts the two required variables and applies defaults', () => {
      const result = parseEnv(VALID);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config).toMatchObject({
        nodeEnv: 'development',
        apiPort: 4000,
        databaseUrl: VALID.DATABASE_URL,
        webOrigin: 'http://localhost:3000',
        trustedOrigins: ['http://localhost:3000'],
        logLevel: 'info',
        authRateLimitEnabled: false,
      });
    });

    it('reads every variable from the source', () => {
      const result = parseEnv({
        ...VALID,
        NODE_ENV: 'production',
        API_PORT: '4100',
        TRUSTED_ORIGINS: 'https://a.example, https://b.example',
        LOG_LEVEL: 'warn',
      });
      expect(result.ok && result.config).toMatchObject({
        nodeEnv: 'production',
        apiPort: 4100,
        trustedOrigins: ['https://a.example', 'https://b.example'],
        logLevel: 'warn',
        authRateLimitEnabled: true,
      });
    });
  });

  describe('edge cases', () => {
    it('treats empty optional variables as unset', () => {
      const result = parseEnv({ ...VALID, GOOGLE_CLIENT_ID: '  ', SMTP_USER: '' });
      expect(result.ok && result.config.googleClientId).toBeUndefined();
      expect(result.ok && result.config.smtpUser).toBeUndefined();
    });

    it('falls back to WEB_ORIGIN when TRUSTED_ORIGINS has no entries', () => {
      const result = parseEnv({
        ...VALID,
        WEB_ORIGIN: 'https://app.example/x',
        TRUSTED_ORIGINS: ' , ',
      });
      expect(result.ok && result.config.trustedOrigins).toEqual(['https://app.example']);
    });

    it('uses the singular "problem" for a single issue', () => {
      expect(errorMessage({ ...VALID, DATABASE_URL: undefined })).toMatch(
        /^Invalid environment configuration \(1 problem\):/,
      );
    });
  });

  describe('error cases', () => {
    it('lists every missing required variable with a hint', () => {
      const message = errorMessage({});
      expect(message).toBe(
        [
          'Invalid environment configuration (2 problems):',
          '',
          '✖ Missing: set it to your Postgres connection URL',
          '  → at DATABASE_URL',
          '✖ Missing: set it to a random string of at least 32 characters',
          '  → at BETTER_AUTH_SECRET',
          '',
          ENV_HINT,
        ].join('\n'),
      );
    });

    it('names each invalid variable', () => {
      const message = errorMessage({
        ...VALID,
        BETTER_AUTH_SECRET: 'short',
        API_PORT: 'eighty',
        NODE_ENV: 'staging',
        BETTER_AUTH_URL: 'not a url',
      });
      expect(message).toContain('(4 problems)');
      for (const name of ['BETTER_AUTH_SECRET', 'API_PORT', 'NODE_ENV', 'BETTER_AUTH_URL']) {
        expect(message).toContain(`→ at ${name}`);
      }
      expect(message).toContain('Too short: use a random string of at least 32 characters');
    });

    it('makes loadEnv print the report and exit with code 1, without a stack trace', () => {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--eval',
          "import('./src/shared/env.ts').then((m) => m.loadEnv({ DATABASE_URL: '', BETTER_AUTH_SECRET: 'short' }))",
        ],
        { cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Invalid environment configuration (2 problems)');
      expect(result.stderr).toContain('→ at DATABASE_URL');
      expect(result.stderr).toContain(ENV_HINT);
      expect(result.stderr).not.toMatch(/ZodError|\n\s+at .+:\d+:\d+/);
      expect(result.stdout).toBe('');
    });
  });
});
