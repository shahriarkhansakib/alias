import { redirect } from 'next/navigation';
import { SignOutButton } from '@/components/sign-out-button';
import { getServerAccessContext } from '@/lib/server-api';
import { CLIENT_CHAT_HREF } from '@/lib/systems';

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
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">
              A
            </span>
            Alias
          </span>
          <div className="topbar-actions">
            <span className="muted small" data-testid="dashboard-user-email">
              {accessContext.user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="container stack-lg" data-testid="customer-workspace-placeholder">
        <div className="stack-sm">
          <h1 className="title-md">Workspace</h1>
          <p className="muted">
            Welcome, {accessContext.user.name}. Tell Alias about your business and your campaign;
            our team and agents take it from there.
          </p>
        </div>

        <div className="card stack-md" data-testid="client-chat-card">
          <div className="stack-sm">
            <h2 className="feature-title">Chat with Alias</h2>
            <p className="muted">
              Our AI consultant asks about your product, audience, budget and goals, then our team
              confirms your campaign brief with you. Creatives and budget plans are shared with you
              in the chat when they are ready.
            </p>
          </div>
          <a href={CLIENT_CHAT_HREF} className="btn btn-primary btn-lg system-open">
            Chat with Alias
          </a>
        </div>
      </main>
    </div>
  );
}
