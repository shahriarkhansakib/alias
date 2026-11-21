import pino from 'pino';

export const REDACT_PATHS = [
  'cookie',
  'authorization',
  'password',
  'token',
  'secret',
  'accessToken',
  'refreshToken',
  'twoFactorSecret',
  '*.cookie',
  '*.authorization',
  '*.password',
  '*.token',
  '*.secret',
  '*.accessToken',
  '*.refreshToken',
  '*.twoFactorSecret',
  'req.headers.cookie',
  'req.headers.authorization',
  'headers.cookie',
  'headers.authorization',
  'res.headers["set-cookie"]',
];

export type Logger = pino.Logger;

export interface LoggerOptions {
  /** Human-readable single-line output (development only). Default: JSON lines. */
  pretty?: boolean;
}

/**
 * JSON lines in production and test. With `pretty`, pino-pretty prints one coloured line per
 * entry: `HH:MM:ss.l LEVEL [requestId] message {other fields}`. Redaction applies either way.
 */
export function createLogger(level = 'info', options: LoggerOptions = {}): Logger {
  return pino({
    level,
    base: {
      service: 'alias-api',
    },
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(options.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              singleLine: true,
              ignore: 'pid,hostname,service,requestId',
              messageFormat: '{if requestId}[{requestId}] {end}{msg}',
            },
          },
        }
      : {}),
  });
}
