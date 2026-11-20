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

export function createLogger(level = 'info'): Logger {
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
  });
}
