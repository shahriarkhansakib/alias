import { serve } from '@hono/node-server';
import { createApiApp } from './app.js';
import { createDatabase } from './db/client.js';
import { createNodemailerMailer } from './shared/email/nodemailer-mailer.js';
import { loadEnv } from './shared/env.js';
import { createLogger } from './shared/logger.js';

const env = loadEnv();
const logger = createLogger(env.logLevel, { pretty: env.nodeEnv === 'development' });
const database = createDatabase(env.databaseUrl);
const mailer = createNodemailerMailer({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpSecure,
  from: env.emailFrom,
  user: env.smtpUser,
  pass: env.smtpPass,
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
