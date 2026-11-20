import Link from 'next/link';
import { getServerAccessContext } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const accessContext = await getServerAccessContext();
  const workspaceHref = accessContext?.principalType === 'admin' ? '/admin' : '/dashboard';

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">Alias</span>
        </div>
      </header>

      <main className="center-main">
        <div className="card landing-card stack-lg">
          <div className="stack-sm">
            <h1 className="title-lg">Alias</h1>
            <p className="muted">Sign in or create an account to continue to your workspace.</p>
          </div>

          {accessContext ? (
            <div className="row row-center">
              <Link href={workspaceHref} className="btn btn-primary">
                Continue to workspace
              </Link>
            </div>
          ) : (
            <div className="row row-center">
              <Link href="/login" className="btn btn-primary">
                Sign in
              </Link>
              <Link href="/register" className="btn btn-secondary">
                Create account
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
