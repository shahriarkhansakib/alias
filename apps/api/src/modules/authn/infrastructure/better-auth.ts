import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { generateId } from '../../../shared/id.js';
import type { Logger } from '../../../shared/logger.js';
import type { MailerPort } from '../../../shared/ports.js';
import { authnSchema } from './schema.js';

export interface BetterAuthConfig {
  db: NodePgDatabase<Record<string, unknown>>;
  secret: string;
  baseUrl: string;
  trustedOrigins: string[];
  nodeEnv: 'development' | 'test' | 'production';
  mailer: MailerPort;
  logger: Logger;
  googleClientId?: string;
  googleClientSecret?: string;
  rateLimitEnabled: boolean;
}

export function createBetterAuth(config: BetterAuthConfig) {
  const isProduction = config.nodeEnv === 'production';

  return betterAuth({
    appName: 'Alias',
    baseURL: config.baseUrl,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(config.db, {
      provider: 'pg',
      schema: authnSchema,
    }),
    advanced: {
      database: {
        generateId: () => generateId(),
      },
      disableOriginCheck: false,
      useSecureCookies: isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        path: '/',
      },
    },
    session: {
      cookieCache: {
        enabled: false,
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        try {
          await config.mailer.sendEmail({
            to: user.email,
            subject: 'Reset your Alias password',
            text: `Reset your Alias password by visiting: ${url}`,
            html: `<p>Reset your Alias password by clicking <a href="${url}">this link</a>.</p><p>If you did not request this, you can safely ignore this email.</p>`,
          });
        } catch (error) {
          config.logger.error({ err: error }, 'Failed to send password reset email');
          throw error;
        }
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        try {
          await config.mailer.sendEmail({
            to: user.email,
            subject: 'Verify your Alias email address',
            text: `Verify your Alias email address by visiting: ${url}`,
            html: `<p>Welcome to Alias, ${user.name}.</p><p>Verify your email address by clicking <a href="${url}">Verify email</a>.</p>`,
          });
        } catch (error) {
          config.logger.error({ err: error }, 'Failed to send verification email');
          throw error;
        }
      },
    },
    socialProviders:
      config.googleClientId && config.googleClientSecret
        ? {
            google: {
              clientId: config.googleClientId,
              clientSecret: config.googleClientSecret,
            },
          }
        : undefined,
    rateLimit: {
      enabled: config.rateLimitEnabled,
      storage: 'database',
      modelName: 'rateLimit',
      window: 60,
      max: 100,
    },
    plugins: [
      twoFactor({
        issuer: 'Alias',
      }),
    ],
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
