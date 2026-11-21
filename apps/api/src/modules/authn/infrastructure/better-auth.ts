import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { generateId } from '../../../shared/id.js';
import type { Logger } from '../../../shared/logger.js';
import type { EmailMessage, MailerPort } from '../../../shared/ports.js';
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

  /**
   * Sends an auth email. On failure logs exactly one line (user id, error code and message, no
   * stack and no address) and resolves, so Better Auth does not log the same failure again.
   */
  async function deliver(kind: string, userId: string, message: EmailMessage): Promise<void> {
    try {
      await config.mailer.sendEmail(message);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
      const reason = error instanceof Error && error.message ? error.message : String(error);
      config.logger.error({ userId, code }, `Failed to send ${kind} email: ${reason}`);
    }
  }

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
      // Run Better Auth's background work (verification and reset emails, cleanup) without
      // awaiting it, so sign-up does not wait for SMTP. `deliver` never rejects, and Better Auth
      // attaches its own catch before calling this handler.
      backgroundTasks: {
        handler: (promise) => {
          void promise;
        },
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
        await deliver('password reset', user.id, {
          to: user.email,
          subject: 'Reset your Alias password',
          text: `Reset your Alias password by visiting: ${url}`,
          html: `<p>Reset your Alias password by clicking <a href="${url}">this link</a>.</p><p>If you did not request this, you can safely ignore this email.</p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        await deliver('verification', user.id, {
          to: user.email,
          subject: 'Verify your Alias email address',
          text: `Verify your Alias email address by visiting: ${url}`,
          html: `<p>Welcome to Alias, ${user.name}.</p><p>Verify your email address by clicking <a href="${url}">Verify email</a>.</p>`,
        });
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
