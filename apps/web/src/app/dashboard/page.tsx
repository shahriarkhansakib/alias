import { redirect } from 'next/navigation';
import { SignOutButton } from '@/components/sign-out-button';
import { getServerAccessContext } from '@/lib/server-api';
import { getAliasSystems } from '@/lib/systems';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const accessContext = await getServerAccessContext();
  if (!accessContext) {
    redirect('/login');
  }

  if (accessContext.principalType === 'admin') {
    redirect('/admin');
  }

  const systems = getAliasSystems();

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
            Welcome, {accessContext.user.name}. Run a campaign through the three Alias systems in
            order: brief, creative, then publish and measure.
          </p>
        </div>

        <ol className="system-flow">
          {systems.map((system) => (
            <li
              key={system.id}
              className="card system-card stack-sm"
              data-testid={`system-card-${system.id}`}
            >
              <span className="system-step">{system.step}</span>
              <h2 className="feature-title">{system.name}</h2>
              <p className="muted">{system.summary}</p>
              <ul className="system-points">
                {system.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <a
                href={system.url}
                className="btn btn-primary system-open"
                target="_blank"
                rel="noreferrer"
              >
                Open {system.step}
              </a>
            </li>
          ))}
        </ol>

        <p className="small muted">
          Each system runs as its own app for now. If a card does not open, start that system using
          the commands in <span className="mono">systems/README.md</span>.
        </p>
      </main>
    </div>
  );
}
