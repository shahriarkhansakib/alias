import { createDatabase } from '../db/client.js';
import { createDrizzleAuthUserLookup } from '../modules/authn/infrastructure/user-lookup-repository.js';
import { createAuthzInfrastructure } from '../modules/authz/index.js';
import { createBootstrapSuperAdminUseCase } from '../modules/platform-admin/index.js';
import { loadEnv } from '../shared/env.js';

function parseEmailArgument(argv: string[]): string {
  const args = argv.filter((arg) => arg !== '--');
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--email') {
      const value = args[index + 1];
      if (value && !value.startsWith('--')) {
        return value;
      }
    } else if (token?.startsWith('--email=')) {
      return token.slice('--email='.length);
    }
  }
  throw new Error('Usage: pnpm bootstrap:admin -- --email <verified-user-email>');
}

async function main() {
  const email = parseEmailArgument(process.argv.slice(2));
  const env = loadEnv();
  const database = createDatabase(env.databaseUrl);

  try {
    const authUserLookup = createDrizzleAuthUserLookup(database.db);
    const authz = createAuthzInfrastructure(database.db);

    const bootstrapSuperAdmin = createBootstrapSuperAdminUseCase({
      unitOfWork: database.unitOfWork,
      authorizationRepository: authz.authorizationRepository,
      authUserLookup,
      auditLog: authz.auditLogRepository,
    });

    const result = await bootstrapSuperAdmin(email);
    console.log(JSON.stringify(result));
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error('Super admin bootstrap failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
