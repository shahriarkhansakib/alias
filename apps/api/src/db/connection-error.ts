/**
 * Turns database errors into one readable line for CLI scripts and startup logs.
 *
 * Connection failures from `pg` arrive as an AggregateError with an empty message (one inner
 * error per address tried, e.g. ::1 and 127.0.0.1), sometimes wrapped by Drizzle in `cause`.
 * This walks that chain and reports the code, the host:port and a hint. It never prints the
 * connection string, so credentials stay out of the output.
 */

const START_POSTGRES_HINT = 'Is Postgres running? Start it with: docker compose up -d --wait';

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  address?: unknown;
  port?: unknown;
  cause?: unknown;
  errors?: unknown;
}

function asErrorLike(value: unknown): ErrorLike | null {
  return typeof value === 'object' && value !== null ? (value as ErrorLike) : null;
}

/** The error, its `cause` chain and the inner errors of any AggregateError, outermost first. */
function flatten(error: unknown, seen = new Set<unknown>()): ErrorLike[] {
  const current = asErrorLike(error);
  if (!current || seen.has(current)) return [];
  seen.add(current);
  const inner = Array.isArray(current.errors) ? current.errors : [];
  return [
    current,
    ...flatten(current.cause, seen),
    ...inner.flatMap((item: unknown) => flatten(item, seen)),
  ];
}

function formatAddress(address: string, port: unknown): string {
  const host = address.includes(':') ? `[${address}]` : address;
  return typeof port === 'number' || typeof port === 'string' ? `${host}:${port}` : host;
}

function targetFromUrl(databaseUrl: string | undefined): { host: string; database: string } | null {
  if (!databaseUrl) return null;
  try {
    const url = new URL(databaseUrl);
    return {
      host: `${url.hostname}:${url.port || '5432'}`,
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
  } catch {
    return null;
  }
}

export function describeDatabaseError(error: unknown, databaseUrl?: string): string {
  const chain = flatten(error);
  const coded = chain.find((e) => typeof e.code === 'string' && e.code.length > 0);
  const code = typeof coded?.code === 'string' ? coded.code : undefined;

  const tried = [
    ...new Set(
      chain
        .filter((e) => typeof e.address === 'string')
        .map((e) => formatAddress(e.address as string, e.port)),
    ),
  ];
  const configured = targetFromUrl(databaseUrl);
  const target = configured?.host ?? tried[0] ?? 'the configured host';
  const triedNote =
    configured && tried.length > 0 && !(tried.length === 1 && tried[0] === configured.host)
      ? ` (tried ${tried.join(', ')})`
      : '';

  switch (code) {
    case 'ECONNREFUSED':
      return `Cannot reach Postgres at ${target}${triedNote}: connection refused (ECONNREFUSED). ${START_POSTGRES_HINT}`;
    case 'ETIMEDOUT':
    case 'ECONNRESET':
      return `Connection to Postgres at ${target}${triedNote} failed (${code}). ${START_POSTGRES_HINT}`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Cannot resolve the Postgres host in DATABASE_URL (${target}, ${code}). Check the host name in DATABASE_URL.`;
    case '28P01':
    case '28000':
      return `Postgres at ${target} rejected the user name or password (${code}). Check the credentials in DATABASE_URL against docker-compose.yml.`;
    case '3D000':
      return `Database "${configured?.database ?? '?'}" does not exist on ${target} (3D000). Check the database name in DATABASE_URL against POSTGRES_DB in docker-compose.yml.`;
    default: {
      const message = chain
        .map((e) => (typeof e.message === 'string' ? e.message.trim() : ''))
        .find((m) => m.length > 0);
      const text = message ?? (String(error) || 'Unknown error');
      return code ? `${text} (${code})` : text;
    }
  }
}
