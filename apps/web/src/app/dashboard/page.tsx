import { redirect } from 'next/navigation';
import { SignOutButton } from '@/components/sign-out-button';
import { getServerAccessContext } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const accessContext = await getServerAccessContext();
  if (!accessContext) {
    redirect('/login');
  }

  if (accessContext.principalType === 'admin') {
    redirect('/admin');
  }

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">Alias</span>
          <div className="topbar-actions">
            <span className="muted small" data-testid="dashboard-user-email">
              {accessContext.user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="container">
        <div className="empty-workspace stack-sm" data-testid="customer-workspace-placeholder">
          <h1 className="title-md">Workspace</h1>
          <p className="muted">Your account is signed in and ready for workspace features.</p>
        </div>
      </main>
    </div>
  );
}
