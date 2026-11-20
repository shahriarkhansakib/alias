import Link from 'next/link';
import { getServerAccessContext } from '@/lib/server-api';
import { getAliasSystems } from '@/lib/systems';

export const dynamic = 'force-dynamic';

const PROBLEMS = [
  {
    title: 'Boosting blind',
    text: 'Small online sellers spend on Facebook boosts with no brief, no strategy and no testing.',
  },
  {
    title: 'Agencies cost too much',
    text: 'A marketing team is out of reach for most shops that sell through Facebook and Instagram.',
  },
  {
    title: 'AI tools make things up',
    text: 'Generic image and copy tools invent products and claims, which hurts trust and gets ads rejected.',
  },
];

const PRINCIPLES = [
  {
    title: 'AI proposes, code and people decide',
    text: 'Agents draft briefs, angles, copy and creative. Deterministic checks and a human operator approve what goes live.',
  },
  {
    title: 'Real products only',
    text: 'The product photo is never regenerated. AI creates the background; code places the product, text and logo.',
  },
  {
    title: 'Verified claims',
    text: 'Copy is checked against what the client confirmed. Unconfirmed discounts and health claims are blocked.',
  },
];

export default async function HomePage() {
  const accessContext = await getServerAccessContext();
  const workspaceHref = accessContext?.principalType === 'admin' ? '/admin' : '/dashboard';
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
          <nav className="topbar-actions" aria-label="Main">
            <a href="#how-it-works" className="btn btn-link">
              How it works
            </a>
            {accessContext ? (
              <Link href={workspaceHref} className="btn btn-primary">
                Continue to workspace
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-secondary">
                  Sign in
                </Link>
                <Link href="/register" className="btn btn-primary">
                  Create account
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-inner stack-md">
            <span className="badge badge-accent hero-badge">
              AI marketing agency for online sellers
            </span>
            <h1 className="hero-title">
              Your marketing team, run by AI agents and checked by people.
            </h1>
            <p className="hero-lead">
              Alias plans your campaign in a chat, turns your real product photos into
              platform-ready ads, publishes them to your page and tracks what sells.
            </p>
            <div className="row row-center">
              {accessContext ? (
                <Link href={workspaceHref} className="btn btn-primary btn-lg">
                  Open your workspace
                </Link>
              ) : (
                <>
                  <Link href="/register" className="btn btn-primary btn-lg">
                    Start a campaign
                  </Link>
                  <a href="#how-it-works" className="btn btn-secondary btn-lg">
                    See how it works
                  </a>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-inner stack-lg">
            <div className="section-head stack-sm">
              <h2 className="title-md">The problem</h2>
              <p className="muted">Why small sellers waste their ad budget today.</p>
            </div>
            <div className="feature-grid">
              {PROBLEMS.map((item) => (
                <div key={item.title} className="card feature-card stack-sm">
                  <h3 className="feature-title">{item.title}</h3>
                  <p className="muted">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-alt" id="how-it-works">
          <div className="section-inner stack-lg">
            <div className="section-head stack-sm">
              <h2 className="title-md">How Alias works</h2>
              <p className="muted">Three systems hand the campaign from one to the next.</p>
            </div>
            <ol className="system-flow">
              {systems.map((system) => (
                <li key={system.id} className="card system-card stack-sm">
                  <span className="system-step">{system.step}</span>
                  <h3 className="feature-title">{system.name}</h3>
                  <p className="muted">{system.summary}</p>
                  <ul className="system-points">
                    {system.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section">
          <div className="section-inner stack-lg">
            <div className="section-head stack-sm">
              <h2 className="title-md">Built to be trusted</h2>
              <p className="muted">The rules every Alias agent works under.</p>
            </div>
            <div className="feature-grid">
              {PRINCIPLES.map((item) => (
                <div key={item.title} className="card feature-card stack-sm">
                  <h3 className="feature-title">{item.title}</h3>
                  <p className="muted">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-alt">
          <div className="section-inner cta stack-md">
            <h2 className="title-md">Ready to stop boosting blind?</h2>
            <p className="muted">Create an account and tell Alias about your business.</p>
            <div className="row row-center">
              <Link
                href={accessContext ? workspaceHref : '/register'}
                className="btn btn-primary btn-lg"
              >
                {accessContext ? 'Open your workspace' : 'Start your first campaign'}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="section-inner row row-between">
          <span className="small muted">© 2026 Alias</span>
          <span className="small muted">CommerceSphere AI · GrowthPilot</span>
        </div>
      </footer>
    </div>
  );
}
