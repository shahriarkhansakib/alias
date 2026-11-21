import { serve } from '@hono/node-server';
import { createApiApp } from './app.js';
import { createDatabase } from './db/client.js';
import { describeDatabaseError } from './db/connection-error.js';
import {
  createNodemailerMailer,
  DEVELOPMENT_SMTP_TIMEOUTS,
} from './shared/email/nodemailer-mailer.js';
import { loadEnv } from './shared/env.js';
import { createLogger } from './shared/logger.js';

const env = loadEnv();
const logger = createLogger(env.logLevel, { pretty: env.nodeEnv === 'development' });
const database = createDatabase(env.databaseUrl);
// Fail loudly but keep serving: the pool reconnects on demand once Postgres is up.
database.ping().catch((error: unknown) => {
  logger.error(
    `${describeDatabaseError(error, env.databaseUrl)} The API keeps running and connects once Postgres is up.`,
  );
});
const mailer = createNodemailerMailer({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpSecure,
  from: env.emailFrom,
  user: env.smtpUser,
  pass: env.smtpPass,
  timeouts: env.nodeEnv === 'development' ? DEVELOPMENT_SMTP_TIMEOUTS : undefined,
});

const { app } = createApiApp({
  env,
  db: database.db,
  unitOfWork: database.unitOfWork,
  pingDb: database.ping,
  mailer,
  logger,
});

const server = serve(
  {
    fetch: app.fetch,
    port: env.apiPort,
    hostname: env.apiHost,
  },
  (info) => {
    logger.info({ host: env.apiHost, port: info.port }, 'Alias API server listening');
  },
);

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down Alias API server');
  server.close(async () => {
    await database.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
