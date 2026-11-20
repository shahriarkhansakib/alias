import { getAdminSystemLinks } from '@/lib/systems';

export function AdminSystemsSection() {
  const links = getAdminSystemLinks();
  return (
    <section className="card stack-md" data-testid="admin-systems-section">
      <div className="stack-sm">
        <h2 className="title-md">Systems & agents</h2>
        <p className="muted">
          Everything runs on this address. Open a system to work on a client's campaign.
        </p>
      </div>
      <div className="feature-grid">
        {links.map((link) => (
          <a
            key={link.id}
            href={link.href}
            className="subcard system-link stack-sm"
            data-testid={`admin-system-${link.id}`}
          >
            <span className="system-step">{link.system}</span>
            <span className="feature-title">{link.name}</span>
            <span className="muted small">{link.description}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
