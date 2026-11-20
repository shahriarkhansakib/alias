import { redirect } from 'next/navigation';
import { MfaEnrollmentGate } from '@/components/mfa-enrollment-gate';
import { PlatformAdminPanel } from '@/components/platform-admin-panel';
import { SignOutButton } from '@/components/sign-out-button';
import {
  getServerAccessContext,
  getServerPlatformAdmins,
  getServerPlatformStatus,
} from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const accessContext = await getServerAccessContext();
  if (!accessContext) {
    redirect('/login');
  }

  if (accessContext.principalType !== 'admin' || !accessContext.platformRoleKey) {
    redirect('/dashboard');
  }

  if (accessContext.mfaRequired) {
    return (
      <MfaEnrollmentGate email={accessContext.user.email} roleKey={accessContext.platformRoleKey} />
    );
  }

  const [status, adminsResponse] = await Promise.all([
    getServerPlatformStatus(),
    getServerPlatformAdmins(),
  ]);

  if (!status || !adminsResponse) {
    return (
      <div className="page-shell">
        <header className="topbar">
          <div className="topbar-inner">
            <span className="brand">Alias Platform Admin</span>
            <div className="topbar-actions">
              <span className="muted small">{accessContext.user.email}</span>
              <SignOutButton />
            </div>
          </div>
        </header>
        <main className="center-main">
          <div className="card auth-card stack-sm">
            <h1 className="title-md">Platform status unavailable</h1>
            <p className="muted">
              Unable to load platform status from the API right now. Please try again.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <PlatformAdminPanel
      actorEmail={accessContext.user.email}
      actorRoleKey={accessContext.platformRoleKey}
      initialStatus={status}
      initialAdmins={adminsResponse.admins}
      initialRequirePlatformMfa={accessContext.requirePlatformMfa}
      initialPersonalMfaEnabled={accessContext.user.mfaEnabled}
    />
  );
}
