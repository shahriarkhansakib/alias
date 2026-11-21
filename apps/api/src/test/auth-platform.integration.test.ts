import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../app.js';
import { createDatabase } from '../db/client.js';
import { resetLocalDatabase } from '../db/reset-schema.js';
import {
  account,
  auditLogs,
  platformSecuritySettings,
  rateLimit,
  session,
  user,
} from '../db/schema.js';
import { loadEnv } from '../shared/env.js';
import { ConflictError, NotFoundError } from '../shared/errors.js';
import { isUuidV7 } from '../shared/id.js';
import { createLogger } from '../shared/logger.js';
import type { EmailMessage, MailerPort } from '../shared/ports.js';
import { extractSecretFromTotpUri, generateTotpCode } from './totp.js';

const TRUSTED_ORIGIN = 'http://localhost:3000';

function extractCookiePairs(response: Response): string {
  const setCookies = response.headers.getSetCookie();
  return setCookies
    .map((header) => header.split(';')[0]?.trim())
    .filter((pair): pair is string => Boolean(pair))
    .join('; ');
}

function mergeCookieHeaders(existing: string, incomingResponse: Response): string {
  const jar = new Map<string, string>();
  for (const part of existing
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const eqIndex = part.indexOf('=');
    if (eqIndex > 0) {
      jar.set(part.slice(0, eqIndex), part.slice(eqIndex + 1));
    }
  }
  for (const setCookie of incomingResponse.headers.getSetCookie()) {
    const first = setCookie.split(';')[0]?.trim();
    if (!first) continue;
    const eqIndex = first.indexOf('=');
    if (eqIndex > 0) {
      const name = first.slice(0, eqIndex);
      const value = first.slice(eqIndex + 1);
      if (value.length === 0) {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    }
  }
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function extractLinkFromEmail(email: EmailMessage): string {
  const match = email.text.match(/https?:\/\/\S+/);
  if (!match?.[0]) {
    throw new Error(`No URL found in captured email: ${email.text}`);
  }
  return match[0];
}

describe('Authn, Authz, Bootstrap & Platform Admin PostgreSQL 18 Integration', () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    BETTER_AUTH_URL: TRUSTED_ORIGIN,
    WEB_ORIGIN: TRUSTED_ORIGIN,
    TRUSTED_ORIGINS: TRUSTED_ORIGIN,
    AUTH_RATE_LIMIT_ENABLED: 'false',
    LOG_LEVEL: 'silent',
  });

  const sentEmails: EmailMessage[] = [];
  const captureMailer: MailerPort = {
    async sendEmail(message) {
      sentEmails.push(message);
    },
  };

  let database: ReturnType<typeof createDatabase>;
  let api: ReturnType<typeof createApiApp>;

  async function registerUser(name: string, email: string, password: string) {
    const countBefore = sentEmails.length;
    const res = await api.app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
      },
      body: JSON.stringify({ name, email, password, callbackURL: '/dashboard' }),
    });
    expect(res.status).toBe(200);
    const emailMsg = sentEmails.slice(countBefore).find((m) => m.to === email);
    if (!emailMsg) {
      throw new Error(`Expected verification email for ${email}`);
    }
    return { response: res, verificationUrl: extractLinkFromEmail(emailMsg) };
  }

  async function verifyViaUrl(verificationUrl: string) {
    const parsed = new URL(verificationUrl);
    const res = await api.app.request(`${parsed.pathname}${parsed.search}`, {
      method: 'GET',
      headers: {
        origin: TRUSTED_ORIGIN,
      },
    });
    return res;
  }

  async function signInUser(email: string, password: string) {
    const res = await api.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
      },
      body: JSON.stringify({ email, password }),
    });
    return res;
  }

  beforeAll(async () => {
    await resetLocalDatabase(env.databaseUrl);
    database = createDatabase(env.databaseUrl);
    api = createApiApp({
      env,
      db: database.db,
      unitOfWork: database.unitOfWork,
      pingDb: database.ping,
      mailer: captureMailer,
      logger: createLogger('silent'),
    });
  });

  afterAll(async () => {
    await database.close();
  });

  it('registers with scrypt + UUIDv7, rejects unverified login, verifies with secure cookies, and protects duplicate email sign-up', async () => {
    const customerEmail = 'customer1@example.com';
    const password = 'Password123!';

    const { verificationUrl } = await registerUser('Customer One', customerEmail, password);

    const [createdUser] = await database.db
      .select()
      .from(user)
      .where(eq(user.email, customerEmail));
    if (!createdUser) {
      throw new Error('Expected createdUser row in PostgreSQL');
    }
    expect(isUuidV7(createdUser.id)).toBe(true);
    expect(createdUser.emailVerified).toBe(false);

    const [createdAccount] = await database.db
      .select()
      .from(account)
      .where(eq(account.userId, createdUser.id));
    if (!createdAccount?.password) {
      throw new Error('Expected createdAccount row with password hash');
    }
    expect(isUuidV7(createdAccount.id)).toBe(true);
    expect(createdAccount.password).not.toBe(password);
    expect(createdAccount.password.includes(':')).toBe(true);

    // Unverified login must be rejected
    const unverifiedLoginRes = await signInUser(customerEmail, password);
    expect(unverifiedLoginRes.status).toBe(403);

    // Verify email and inspect cookies
    const verifyRes = await verifyViaUrl(verificationUrl);
    expect([200, 302]).toContain(verifyRes.status);
    const setCookies = verifyRes.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThan(0);
    for (const cookieStr of setCookies) {
      expect(cookieStr.toLowerCase()).toContain('httponly');
      expect(cookieStr.toLowerCase()).toContain('samesite=lax');
    }

    const customerCookie = extractCookiePairs(verifyRes);
    expect(customerCookie.length).toBeGreaterThan(0);

    // Access context & customer workspace succeed; platform routes fail with 403
    const accessRes = await api.app.request('/api/v1/access-context', {
      headers: { cookie: customerCookie },
    });
    expect(accessRes.status).toBe(200);
    const accessBody = (await accessRes.json()) as {
      principalType: string;
      platformRoleKey: string | null;
      mfaRequired: boolean;
      user: { emailVerified: boolean; mfaEnabled: boolean };
    };
    expect(accessBody.principalType).toBe('user');
    expect(accessBody.platformRoleKey).toBeNull();
    expect(accessBody.mfaRequired).toBe(false);
    expect(accessBody.user.emailVerified).toBe(true);

    const customerWorkspaceRes = await api.app.request('/api/v1/customer/workspace', {
      headers: { cookie: customerCookie },
    });
    expect(customerWorkspaceRes.status).toBe(200);

    const forbiddenPlatformStatus = await api.app.request('/api/v1/platform/status', {
      headers: { cookie: customerCookie },
    });
    expect(forbiddenPlatformStatus.status).toBe(403);

    // Duplicate email sign-up does not overwrite user, change password, create duplicate row, or grant session
    const duplicateRes = await api.app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
      },
      body: JSON.stringify({
        name: 'Hijack Attempt',
        email: customerEmail,
        password: 'OtherPassword999!',
      }),
    });
    expect(extractCookiePairs(duplicateRes)).toBe('');

    const usersWithEmail = await database.db
      .select()
      .from(user)
      .where(eq(user.email, customerEmail));
    expect(usersWithEmail).toHaveLength(1);
    expect(usersWithEmail[0]?.name).toBe('Customer One');
    expect((await signInUser(customerEmail, 'OtherPassword999!')).status).toBe(401);
    expect((await signInUser(customerEmail, password)).status).toBe(200);
  });

  it('revokes all existing sessions when password is reset', async () => {
    const email = 'reset-user@example.com';
    const oldPassword = 'OldPassword123!';
    const newPassword = 'NewPassword456!';

    const { verificationUrl } = await registerUser('Reset User', email, oldPassword);
    await verifyViaUrl(verificationUrl);

    const loginOne = await signInUser(email, oldPassword);
    expect(loginOne.status).toBe(200);
    const cookieOne = extractCookiePairs(loginOne);

    const loginTwo = await signInUser(email, oldPassword);
    expect(loginTwo.status).toBe(200);
    const cookieTwo = extractCookiePairs(loginTwo);

    // Confirm both sessions work before reset
    expect((await api.app.request('/api/v1/me', { headers: { cookie: cookieOne } })).status).toBe(
      200,
    );
    expect((await api.app.request('/api/v1/me', { headers: { cookie: cookieTwo } })).status).toBe(
      200,
    );

    const countBefore = sentEmails.length;
    const reqResetRes = await api.app.request('/api/auth/request-password-reset', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
      },
      body: JSON.stringify({ email, redirectTo: '/login' }),
    });
    expect(reqResetRes.status).toBe(200);

    const resetEmail = sentEmails.slice(countBefore).find((m) => m.to === email);
    if (!resetEmail) {
      throw new Error('Expected password reset email');
    }
    const resetUrl = new URL(extractLinkFromEmail(resetEmail));
    const token =
      resetUrl.searchParams.get('token') ??
      resetUrl.pathname.split('/').filter(Boolean).pop() ??
      null;
    expect(token).toBeTruthy();

    const resetRes = await api.app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
      },
      body: JSON.stringify({ newPassword, token }),
    });
    expect(resetRes.status).toBe(200);

    // Both prior sessions must now be invalid
    expect((await api.app.request('/api/v1/me', { headers: { cookie: cookieOne } })).status).toBe(
      401,
    );
    expect((await api.app.request('/api/v1/me', { headers: { cookie: cookieTwo } })).status).toBe(
      401,
    );

    const [resetUser] = await database.db.select().from(user).where(eq(user.email, email));
    if (!resetUser) {
      throw new Error('Expected resetUser row');
    }
    const remainingSessions = await database.db
      .select()
      .from(session)
      .where(eq(session.userId, resetUser.id));
    expect(remainingSessions).toHaveLength(0);

    // New password works
    const relogin = await signInUser(email, newPassword);
    expect(relogin.status).toBe(200);
  });

  it('rejects untrusted Origins on /api/auth/* and /api/v1/* state-changing endpoints', async () => {
    const authCsrfRes = await api.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
      },
      body: JSON.stringify({ email: 'customer1@example.com', password: 'Password123!' }),
    });
    expect(authCsrfRes.status).toBe(403);

    const v1CsrfRes = await api.app.request('/api/v1/platform/admins', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
      },
      body: JSON.stringify({ email: 'customer1@example.com', roleKey: 'platform_admin' }),
    });
    expect(v1CsrfRes.status).toBe(403);
    const v1CsrfBody = (await v1CsrfRes.json()) as { error: { code: string } };
    expect(v1CsrfBody.error.code).toBe('CSRF_ORIGIN_INVALID');
  });

  it('enforces bootstrap idempotency, hijack refusal, MFA gate, admin provisioning, mutual exclusion, and persistent audit logs', async () => {
    const superAdminEmail = 'superadmin@example.com';
    const superAdminPassword = 'SuperAdminPassword123!';
    const secondAdminEmail = 'operator@example.com';
    const secondAdminPassword = 'OperatorPassword123!';
    const unverifiedEmail = 'unverified@example.com';

    // 1. Register unverified user, verify superAdmin & secondAdmin candidates
    await registerUser('Unverified User', unverifiedEmail, 'Unverified123!');
    const superReg = await registerUser('Super Admin', superAdminEmail, superAdminPassword);
    await verifyViaUrl(superReg.verificationUrl);
    const secondReg = await registerUser(
      'Platform Operator',
      secondAdminEmail,
      secondAdminPassword,
    );
    await verifyViaUrl(secondReg.verificationUrl);

    // 2. Bootstrap rejects unknown & unverified emails and persists audit_logs outside rolled-back tx
    await expect(api.bootstrapSuperAdmin('missing@example.com')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(api.bootstrapSuperAdmin(unverifiedEmail)).rejects.toBeInstanceOf(ConflictError);

    // 3. First bootstrap succeeds; repeat for same user is idempotent; second user is rejected (409)
    const firstBootstrap = await api.bootstrapSuperAdmin(superAdminEmail);
    expect(firstBootstrap.outcome).toBe('created');

    const repeatBootstrap = await api.bootstrapSuperAdmin(superAdminEmail);
    expect(repeatBootstrap.outcome).toBe('already_bootstrapped');
    expect(repeatBootstrap.assignmentId).toBe(firstBootstrap.assignmentId);

    try {
      await api.bootstrapSuperAdmin(secondAdminEmail);
      expect.unreachable('Expected hijack bootstrap attempt to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).code).toBe('SUPER_ADMIN_ALREADY_EXISTS');
    }

    const bootstrapLogs = await database.db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt));
    const actions = bootstrapLogs.map((entry) => entry.action);
    expect(actions).toContain('platform.super_admin.bootstrap.succeeded');
    expect(actions).toContain('platform.super_admin.bootstrap.idempotent');
    expect(actions.filter((a) => a === 'platform.super_admin.bootstrap.rejected').length).toBe(3);

    // 4. Newly bootstrapped super_admin signs in without MFA -> access-context ok, platform/* blocked with PLATFORM_MFA_REQUIRED, customer/* blocked
    const superLogin = await signInUser(superAdminEmail, superAdminPassword);
    expect(superLogin.status).toBe(200);
    let superCookie = extractCookiePairs(superLogin);

    const preMfaContext = await api.app.request('/api/v1/access-context', {
      headers: { cookie: superCookie },
    });
    expect(preMfaContext.status).toBe(200);
    const preMfaBody = (await preMfaContext.json()) as {
      principalType: string;
      platformRoleKey: string | null;
      requirePlatformMfa: boolean;
      mfaRequired: boolean;
    };
    expect(preMfaBody).toMatchObject({
      principalType: 'admin',
      platformRoleKey: 'super_admin',
      requirePlatformMfa: true,
      mfaRequired: true,
    });

    const preMfaStatus = await api.app.request('/api/v1/platform/status', {
      headers: { cookie: superCookie },
    });
    expect(preMfaStatus.status).toBe(403);
    expect(((await preMfaStatus.json()) as { error: { code: string } }).error.code).toBe(
      'PLATFORM_MFA_REQUIRED',
    );

    const adminCustomerRes = await api.app.request('/api/v1/customer/workspace', {
      headers: { cookie: superCookie },
    });
    expect(adminCustomerRes.status).toBe(403);
    expect(((await adminCustomerRes.json()) as { error: { code: string } }).error.code).toBe(
      'PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED',
    );

    // 5. Enroll & verify TOTP for super_admin -> unlocks platform endpoints
    const enableTotpRes = await api.app.request('/api/auth/two-factor/enable', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: superCookie,
      },
      body: JSON.stringify({ password: superAdminPassword }),
    });
    expect(enableTotpRes.status).toBe(200);
    superCookie = mergeCookieHeaders(superCookie, enableTotpRes);
    const enableData = (await enableTotpRes.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    const superSecret = extractSecretFromTotpUri(enableData.totpURI);
    const superCode = generateTotpCode(superSecret);

    const verifyTotpRes = await api.app.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: superCookie,
      },
      body: JSON.stringify({ code: superCode }),
    });
    expect(verifyTotpRes.status).toBe(200);
    superCookie = mergeCookieHeaders(superCookie, verifyTotpRes);

    const unlockedStatus = await api.app.request('/api/v1/platform/status', {
      headers: { cookie: superCookie },
    });
    expect(unlockedStatus.status).toBe(200);

    // 6. Provision unverified user fails + writes persisted rejection audit log
    const provisionUnverified = await api.app.request('/api/v1/platform/admins', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: superCookie,
      },
      body: JSON.stringify({ email: unverifiedEmail, roleKey: 'platform_admin' }),
    });
    expect(provisionUnverified.status).toBe(409);

    // 7. Provision second verified user as platform_admin -> succeeds + appears in roster
    const provisionSecond = await api.app.request('/api/v1/platform/admins', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: superCookie,
      },
      body: JSON.stringify({
        email: secondAdminEmail,
        roleKey: 'platform_admin',
        reason: 'Operations lead',
      }),
    });
    expect(provisionSecond.status).toBe(201);

    const rosterRes = await api.app.request('/api/v1/platform/admins', {
      headers: { cookie: superCookie },
    });
    expect(rosterRes.status).toBe(200);
    const roster = (await rosterRes.json()) as {
      admins: Array<{ email: string; roleKey: string; mfaEnabled: boolean }>;
    };
    expect(roster.admins.map((a) => a.email)).toEqual(
      expect.arrayContaining([superAdminEmail, secondAdminEmail]),
    );

    // 8. Second platform_admin enables MFA -> can read /platform/status & /platform/admins, blocked from POST /platform/admins and customer workspace
    const secondLogin = await signInUser(secondAdminEmail, secondAdminPassword);
    expect(secondLogin.status).toBe(200);
    let secondCookie = extractCookiePairs(secondLogin);

    const secondEnable = await api.app.request('/api/auth/two-factor/enable', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: secondCookie,
      },
      body: JSON.stringify({ password: secondAdminPassword }),
    });
    expect(secondEnable.status).toBe(200);
    secondCookie = mergeCookieHeaders(secondCookie, secondEnable);
    const secondEnableData = (await secondEnable.json()) as { totpURI: string };
    const secondCode = generateTotpCode(extractSecretFromTotpUri(secondEnableData.totpURI));

    const secondVerify = await api.app.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: secondCookie,
      },
      body: JSON.stringify({ code: secondCode }),
    });
    expect(secondVerify.status).toBe(200);
    secondCookie = mergeCookieHeaders(secondCookie, secondVerify);

    expect(
      (await api.app.request('/api/v1/platform/status', { headers: { cookie: secondCookie } }))
        .status,
    ).toBe(200);
    expect(
      (await api.app.request('/api/v1/platform/admins', { headers: { cookie: secondCookie } }))
        .status,
    ).toBe(200);
    expect(
      (
        await api.app.request('/api/v1/platform/admins', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: TRUSTED_ORIGIN,
            cookie: secondCookie,
          },
          body: JSON.stringify({ email: 'customer1@example.com', roleKey: 'platform_admin' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await api.app.request('/api/v1/customer/workspace', { headers: { cookie: secondCookie } }))
        .status,
    ).toBe(403);

    const allAuditLogs = await database.db.select().from(auditLogs);
    expect(allAuditLogs.some((row) => row.action === 'platform.admin.provision.succeeded')).toBe(
      true,
    );
    expect(allAuditLogs.some((row) => row.action === 'platform.admin.provision.rejected')).toBe(
      true,
    );
  });

  it('persists database-backed rate limits cleanly with PostgreSQL UUID primary keys', async () => {
    const rateLimitedEnv = loadEnv({
      NODE_ENV: 'test',
      BETTER_AUTH_URL: TRUSTED_ORIGIN,
      WEB_ORIGIN: TRUSTED_ORIGIN,
      TRUSTED_ORIGINS: TRUSTED_ORIGIN,
      AUTH_RATE_LIMIT_ENABLED: 'true',
      LOG_LEVEL: 'silent',
    });

    const rateLimitedApi = createApiApp({
      env: rateLimitedEnv,
      db: database.db,
      unitOfWork: database.unitOfWork,
      pingDb: database.ping,
      mailer: captureMailer,
      logger: createLogger('silent'),
    });

    const res = await rateLimitedApi.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        'x-forwarded-for': '203.0.113.42',
      },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'WrongPassword123!' }),
    });
    expect(res.status).toBe(401);

    const rows = await database.db.select().from(rateLimit);
    const firstRow = rows[0];
    expect(firstRow).toBeDefined();
    if (!firstRow) {
      throw new Error('Expected rateLimit row');
    }
    expect(isUuidV7(firstRow.id)).toBe(true);
    expect(firstRow.count).toBeGreaterThanOrEqual(1);
  });

  it('defaults platform 2FA OFF in development, enforces self-lockout guard, logs atomic policy toggles, and gates sub-admins', async () => {
    await resetLocalDatabase(env.databaseUrl);

    const devEnv = loadEnv({
      NODE_ENV: 'development',
      BETTER_AUTH_URL: TRUSTED_ORIGIN,
      WEB_ORIGIN: TRUSTED_ORIGIN,
      TRUSTED_ORIGINS: TRUSTED_ORIGIN,
      AUTH_RATE_LIMIT_ENABLED: 'false',
      LOG_LEVEL: 'silent',
    });

    const devApi = createApiApp({
      env: devEnv,
      db: database.db,
      unitOfWork: database.unitOfWork,
      pingDb: database.ping,
      mailer: captureMailer,
      logger: createLogger('silent'),
    });

    async function devRegisterAndVerify(name: string, email: string, password: string) {
      const countBefore = sentEmails.length;
      const signUpRes = await devApi.app.request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: TRUSTED_ORIGIN,
        },
        body: JSON.stringify({ name, email, password, callbackURL: '/dashboard' }),
      });
      expect(signUpRes.status).toBe(200);
      const emailMsg = sentEmails.slice(countBefore).find((m) => m.to === email);
      if (!emailMsg) {
        throw new Error(`Expected verification email for ${email}`);
      }
      const parsed = new URL(extractLinkFromEmail(emailMsg));
      await devApi.app.request(`${parsed.pathname}${parsed.search}`, {
        method: 'GET',
        headers: { origin: TRUSTED_ORIGIN },
      });
    }

    async function devSignIn(email: string, password: string) {
      const res = await devApi.app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: TRUSTED_ORIGIN,
        },
        body: JSON.stringify({ email, password }),
      });
      expect(res.status).toBe(200);
      return extractCookiePairs(res);
    }

    const rootEmail = 'dev-root@example.com';
    const rootPassword = 'DevRootPassword123!';
    const subEmail = 'dev-sub@example.com';
    const subPassword = 'DevSubPassword123!';

    await devRegisterAndVerify('Dev Root', rootEmail, rootPassword);
    await devRegisterAndVerify('Dev Sub', subEmail, subPassword);
    await devApi.bootstrapSuperAdmin(rootEmail);

    let rootCookie = await devSignIn(rootEmail, rootPassword);

    // 1. In development with no DB row, requirePlatformMfa=false and un-enrolled super_admin can access /api/v1/platform/status
    const devAccessRes = await devApi.app.request('/api/v1/access-context', {
      headers: { cookie: rootCookie },
    });
    expect(devAccessRes.status).toBe(200);
    expect(await devAccessRes.json()).toMatchObject({
      principalType: 'admin',
      platformRoleKey: 'super_admin',
      requirePlatformMfa: false,
      mfaRequired: false,
    });

    const devStatusRes = await devApi.app.request('/api/v1/platform/status', {
      headers: { cookie: rootCookie },
    });
    expect(devStatusRes.status).toBe(200);
    expect(await devStatusRes.json()).toMatchObject({
      requirePlatformMfa: false,
    });

    // Provision un-enrolled sub-admin while policy is OFF
    const provisionSubRes = await devApi.app.request('/api/v1/platform/admins', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: rootCookie,
      },
      body: JSON.stringify({ email: subEmail, roleKey: 'platform_admin' }),
    });
    expect(provisionSubRes.status).toBe(201);

    const subCookie = await devSignIn(subEmail, subPassword);

    // 2. Self-lockout guard: un-enrolled super_admin gets 409 MFA_SETUP_REQUIRED_BEFORE_ENFORCEMENT
    const lockoutRes = await devApi.app.request('/api/v1/platform/security-settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: rootCookie,
      },
      body: JSON.stringify({ requirePlatformMfa: true }),
    });
    expect(lockoutRes.status).toBe(409);
    expect(await lockoutRes.json()).toMatchObject({
      error: {
        code: 'MFA_SETUP_REQUIRED_BEFORE_ENFORCEMENT',
        message:
          'Enable and verify your own 2FA authenticator before turning on the platform-wide 2FA requirement',
      },
    });

    // 3. Enroll & verify personal 2FA for super_admin, then toggle platform 2FA ON
    const enableRes = await devApi.app.request('/api/auth/two-factor/enable', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: rootCookie,
      },
      body: JSON.stringify({ password: rootPassword }),
    });
    expect(enableRes.status).toBe(200);
    rootCookie = mergeCookieHeaders(rootCookie, enableRes);
    const enableData = (await enableRes.json()) as { totpURI: string };
    const rootTotpCode = generateTotpCode(extractSecretFromTotpUri(enableData.totpURI));

    const verifyRes = await devApi.app.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: rootCookie,
      },
      body: JSON.stringify({ code: rootTotpCode }),
    });
    expect(verifyRes.status).toBe(200);
    rootCookie = mergeCookieHeaders(rootCookie, verifyRes);

    const toggleOnRes = await devApi.app.request('/api/v1/platform/security-settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: rootCookie,
      },
      body: JSON.stringify({ requirePlatformMfa: true }),
    });
    expect(toggleOnRes.status).toBe(200);
    expect(await toggleOnRes.json()).toMatchObject({
      requirePlatformMfa: true,
    });

    const [settingsRow] = await database.db
      .select()
      .from(platformSecuritySettings)
      .where(eq(platformSecuritySettings.id, 'default'));
    expect(settingsRow?.requirePlatformMfa).toBe(true);

    // 4. Un-enrolled sub-admin is now blocked with 403 PLATFORM_MFA_REQUIRED
    const subBlockedStatus = await devApi.app.request('/api/v1/platform/status', {
      headers: { cookie: subCookie },
    });
    expect(subBlockedStatus.status).toBe(403);
    expect((await subBlockedStatus.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'PLATFORM_MFA_REQUIRED' },
    });

    // Even an MFA-enrolled platform_admin receives 403 FORBIDDEN on PATCH /security-settings
    let mfaSubCookie = subCookie;
    const subEnable = await devApi.app.request('/api/auth/two-factor/enable', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: mfaSubCookie,
      },
      body: JSON.stringify({ password: subPassword }),
    });
    expect(subEnable.status).toBe(200);
    mfaSubCookie = mergeCookieHeaders(mfaSubCookie, subEnable);
    const subEnableData = (await subEnable.json()) as { totpURI: string };
    const subVerify = await devApi.app.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: mfaSubCookie,
      },
      body: JSON.stringify({
        code: generateTotpCode(extractSecretFromTotpUri(subEnableData.totpURI)),
      }),
    });
    expect(subVerify.status).toBe(200);
    mfaSubCookie = mergeCookieHeaders(mfaSubCookie, subVerify);

    const subToggleAttempt = await devApi.app.request('/api/v1/platform/security-settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: mfaSubCookie,
      },
      body: JSON.stringify({ requirePlatformMfa: false }),
    });
    expect(subToggleAttempt.status).toBe(403);
    expect(await subToggleAttempt.json()).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });

    // 5. super_admin toggles policy OFF -> sub-admin without MFA can access again (register third un-enrolled sub-admin to prove!)
    const thirdEmail = 'dev-sub-nomfa@example.com';
    const thirdPassword = 'DevThirdPassword123!';
    await devRegisterAndVerify('Dev Third', thirdEmail, thirdPassword);
    const provisionThirdRes = await devApi.app.request('/api/v1/platform/admins', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: rootCookie,
      },
      body: JSON.stringify({ email: thirdEmail, roleKey: 'platform_admin' }),
    });
    expect(provisionThirdRes.status).toBe(201);
    const thirdCookie = await devSignIn(thirdEmail, thirdPassword);

    expect(
      (await devApi.app.request('/api/v1/platform/status', { headers: { cookie: thirdCookie } }))
        .status,
    ).toBe(403);

    const toggleOffRes = await devApi.app.request('/api/v1/platform/security-settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: TRUSTED_ORIGIN,
        cookie: rootCookie,
      },
      body: JSON.stringify({ requirePlatformMfa: false }),
    });
    expect(toggleOffRes.status).toBe(200);
    expect(await toggleOffRes.json()).toMatchObject({
      requirePlatformMfa: false,
    });

    const thirdUnlockedStatus = await devApi.app.request('/api/v1/platform/status', {
      headers: { cookie: thirdCookie },
    });
    expect(thirdUnlockedStatus.status).toBe(200);

    // Verify atomic audit_logs records for both toggles
    const policyAuditLogs = await database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'platform.security.mfa_policy_updated'))
      .orderBy(auditLogs.createdAt);
    expect(policyAuditLogs).toHaveLength(2);
    expect(policyAuditLogs[0]?.metadata).toEqual({
      previousRequirePlatformMfa: false,
      nextRequirePlatformMfa: true,
    });
    expect(policyAuditLogs[1]?.metadata).toEqual({
      previousRequirePlatformMfa: true,
      nextRequirePlatformMfa: false,
    });
  });
});
