import { describe, expect, it } from 'vitest';
import { describeDatabaseError } from './connection-error.js';

const URL_LOCAL = 'postgresql://alias:secret-password@localhost:5432/alias';

/** The shape pg-pool produces when every address of a host refuses the connection. */
function refused(port = 5432): AggregateError {
  const inner = ['::1', '127.0.0.1'].map((address) =>
    Object.assign(new Error(`connect ECONNREFUSED ${address}:${port}`), {
      code: 'ECONNREFUSED',
      address,
      port,
    }),
  );
  return Object.assign(new AggregateError(inner, ''), { code: 'ECONNREFUSED' });
}

function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('describeDatabaseError', () => {
  describe('happy paths', () => {
    it('explains a refused connection with host, port, the addresses tried and a hint', () => {
      expect(describeDatabaseError(refused(), URL_LOCAL)).toBe(
        'Cannot reach Postgres at localhost:5432 (tried [::1]:5432, 127.0.0.1:5432): ' +
          'connection refused (ECONNREFUSED). Is Postgres running? Start it with: ' +
          'docker compose up -d --wait',
      );
    });

    it('unwraps a Drizzle query error whose cause is the connection error', () => {
      const wrapped = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"', {
        cause: refused(),
      });
      expect(describeDatabaseError(wrapped, URL_LOCAL)).toMatch(
        /^Cannot reach Postgres at localhost:5432 .*ECONNREFUSED/,
      );
    });

    it('explains a wrong password', () => {
      expect(
        describeDatabaseError(pgError('28P01', 'password authentication failed'), URL_LOCAL),
      ).toBe(
        'Postgres at localhost:5432 rejected the user name or password (28P01). ' +
          'Check the credentials in DATABASE_URL against docker-compose.yml.',
      );
    });

    it('explains a missing database', () => {
      expect(
        describeDatabaseError(pgError('3D000', 'database "x" does not exist'), URL_LOCAL),
      ).toBe(
        'Database "alias" does not exist on localhost:5432 (3D000). ' +
          'Check the database name in DATABASE_URL against POSTGRES_DB in docker-compose.yml.',
      );
    });
  });

  describe('edge cases', () => {
    it('never prints the password from DATABASE_URL', () => {
      for (const error of [refused(), pgError('28P01', 'x'), pgError('3D000', 'x')]) {
        expect(describeDatabaseError(error, URL_LOCAL)).not.toContain('secret-password');
      }
    });

    it('uses the default port 5432 when DATABASE_URL has none', () => {
      expect(describeDatabaseError(refused(), 'postgresql://alias@db.local/alias')).toContain(
        'at db.local:5432',
      );
    });

    it('falls back to the addresses tried when DATABASE_URL is missing or invalid', () => {
      for (const url of [undefined, 'not a url']) {
        expect(describeDatabaseError(refused(6543), url)).toContain('at [::1]:6543');
      }
    });

    it('omits the "tried" note when the only address tried is the configured one', () => {
      const single = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
        code: 'ECONNREFUSED',
        address: '127.0.0.1',
        port: 5432,
      });
      expect(
        describeDatabaseError(single, 'postgresql://alias@127.0.0.1:5432/alias'),
      ).not.toContain('tried');
    });

    it('survives a cause cycle', () => {
      const a: Error & { cause?: unknown } = new Error('outer');
      a.cause = a;
      expect(describeDatabaseError(a, URL_LOCAL)).toBe('outer');
    });
  });

  describe('error cases', () => {
    it('explains an unknown host', () => {
      const error = pgError('ENOTFOUND', 'getaddrinfo ENOTFOUND db.invalid');
      expect(describeDatabaseError(error, 'postgresql://a@db.invalid:5432/a')).toBe(
        'Cannot resolve the Postgres host in DATABASE_URL (db.invalid:5432, ENOTFOUND). ' +
          'Check the host name in DATABASE_URL.',
      );
    });

    it('explains a timeout', () => {
      expect(describeDatabaseError(pgError('ETIMEDOUT', 'timeout'), URL_LOCAL)).toContain(
        'Connection to Postgres at localhost:5432 failed (ETIMEDOUT). Is Postgres running?',
      );
    });

    it('keeps the message and code of other database errors', () => {
      expect(describeDatabaseError(pgError('42P01', 'relation "x" does not exist'))).toBe(
        'relation "x" does not exist (42P01)',
      );
    });

    it('keeps the message of non-database errors such as a failed bootstrap', () => {
      expect(describeDatabaseError(new Error('No registered user found for email a@b.c'))).toBe(
        'No registered user found for email a@b.c',
      );
    });

    it('describes values that are not errors', () => {
      expect(describeDatabaseError('plain string failure')).toBe('plain string failure');
      expect(describeDatabaseError(new AggregateError([], ''))).toBe('AggregateError');
    });
  });
});
