/**
 * Seeds verified demo accounts for local demos and judging.
 *
 *   pnpm seed:demo
 *
 * Creates (or repairs) two accounts through the real Better Auth sign-up flow,
 * marks their emails as verified so no inbox is needed, and bootstraps the admin
 * account as super admin. Safe to run more than once. Refuses to run in production.
 */
import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/client.js';
import { createAuthnInfrastructure } from '../modules/authn/index.js';
import { user } from '../modules/authn/infrastructure/schema.js';
import { createDrizzleAuthUserLookup } from '../modules/authn/infrastructure/user-lookup-repository.js';
import { createAuthzInfrastructure } from '../modules/authz/index.js';
import { createBootstrapSuperAdminUseCase } from '../modules/platform-admin/index.js';
import { loadEnv } from '../shared/env.js';
import { createLogger } from '../shared/logger.js';

export const DEMO_ACCOUNTS = {
  customer: { name: 'Demo Client', email: 'demo@alias.local', password: 'AliasDemo#2026!' },
  admin: { name: 'Demo Admin', email: 'admin@alias.local', password: 'AliasAdmin#2026!' },
} as const;

async function main() {
  const env = loadEnv();
  if (env.nodeEnv === 'production') {
    throw new Error('seed:demo is disabled in production.');
  }

  const database = createDatabase(env.databaseUrl);
  const logger = createLogger('warn');

  try {
    const authn = createAuthnInfrastructure({
      db: database.db as never,
      secret: env.betterAuthSecret,
      baseUrl: env.betterAuthUrl,
      trustedOrigins: env.trustedOrigins,
      nodeEnv: env.nodeEnv,
      mailer: { sendEmail: async () => {} },
      logger,
      rateLimitEnabled: false,
    });

    for (const account of Object.values(DEMO_ACCOUNTS)) {
      const existing = await database.db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, account.email));

      if (existing.length === 0) {
        const response = await authn.handleAuthRequest(
          new Request(new URL('/api/auth/sign-up/email', env.betterAuthUrl), {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: env.webOrigin },
            body: JSON.stringify({
              name: account.name,
              email: account.email,
              password: account.password,
            }),
          }),
        );
        if (!response.ok) {
          throw new Error(`Sign-up failed for ${account.email}: ${await response.text()}`);
        }
      }

      await database.db
        .update(user)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(user.email, account.email));
    }

    const authz = createAuthzInfrastructure(database.db);
    const bootstrapSuperAdmin = createBootstrapSuperAdminUseCase({
      unitOfWork: database.unitOfWork,
      authorizationRepository: authz.authorizationRepository,
      authUserLookup: createDrizzleAuthUserLookup(database.db),
      auditLog: authz.auditLogRepository,
    });

    try {
      await bootstrapSuperAdmin(DEMO_ACCOUNTS.admin.email);
    } catch (error) {
      console.warn(
        'Admin bootstrap skipped:',
        error instanceof Error ? error.message : String(error),
      );
    }

    console.log('Demo accounts ready (emails verified):');
    console.log(`  Client: ${DEMO_ACCOUNTS.customer.email} / ${DEMO_ACCOUNTS.customer.password}`);
    console.log(`  Admin:  ${DEMO_ACCOUNTS.admin.email} / ${DEMO_ACCOUNTS.admin.password}`);
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error('Demo seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
