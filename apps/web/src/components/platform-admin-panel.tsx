'use client';

import type {
  ApiErrorEnvelope,
  PlatformAdminItem,
  PlatformRoleKey,
  PlatformStatusResponse,
  ProvisionPlatformAdminResponse,
} from '@alias/contracts';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { PlatformSecurityCard } from './platform-security-card';
import { SignOutButton } from './sign-out-button';

export function PlatformAdminPanel(props: {
  actorEmail: string;
  actorRoleKey: PlatformRoleKey;
  initialStatus: PlatformStatusResponse;
  initialAdmins: PlatformAdminItem[];
  initialRequirePlatformMfa: boolean;
  initialPersonalMfaEnabled: boolean;
  systemsSection?: ReactNode;
}) {
  const [admins, setAdmins] = useState<PlatformAdminItem[]>(props.initialAdmins);
  const [activeAdminCount, setActiveAdminCount] = useState<number>(
    props.initialStatus.activeAdminCount,
  );

  useEffect(() => {
    setAdmins(props.initialAdmins);
  }, [props.initialAdmins]);

  useEffect(() => {
    setActiveAdminCount(props.initialStatus.activeAdminCount);
  }, [props.initialStatus.activeAdminCount]);
  const [targetEmail, setTargetEmail] = useState('');
  const [reason, setReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const canProvisionAdmins = props.actorRoleKey === 'super_admin';

  async function handleProvisionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsPending(true);

    try {
      const response = await fetch('/api/v1/platform/admins', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: targetEmail.trim().toLowerCase(),
          roleKey: 'platform_admin',
          ...(reason.trim().length > 0 ? { reason: reason.trim() } : {}),
        }),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as ApiErrorEnvelope | null;
        setErrorMessage(errorBody?.error.message ?? 'Unable to provision platform administrator.');
        return;
      }

      const payload = (await response.json()) as ProvisionPlatformAdminResponse;
      setAdmins((current) => [payload.admin, ...current]);
      setActiveAdminCount((count) => count + 1);
      setSuccessMessage(`Provisioned ${payload.admin.email} as ${payload.admin.roleKey}.`);
      setTargetEmail('');
      setReason('');
    } catch {
      setErrorMessage('Unexpected error while provisioning platform administrator.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="row">
            <span className="brand">Alias Platform Admin</span>
            <span className="badge badge-accent">{props.actorRoleKey}</span>
          </div>
          <div className="topbar-actions">
            <span className="muted small">{props.actorEmail}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="container stack-lg">
        {props.systemsSection}
        <section className="card stack-md">
          <div className="row row-between">
            <div className="stack-sm">
              <h1 className="title-md">Platform status</h1>
              <p className="muted">Operational status for the Alias platform control plane.</p>
            </div>
            <span className="badge badge-accent">{props.initialStatus.status}</span>
          </div>

          <div className="row" style={{ gap: '2rem' }}>
            <div className="stack-sm">
              <span className="muted small">Service</span>
              <strong>{props.initialStatus.service}</strong>
            </div>
            <div className="stack-sm">
              <span className="muted small">Database</span>
              <strong>{props.initialStatus.database}</strong>
            </div>
            <div className="stack-sm">
              <span className="muted small">Active platform admins</span>
              <strong data-testid="active-admin-count">{activeAdminCount}</strong>
            </div>
          </div>
        </section>

        <PlatformSecurityCard
          actorRoleKey={props.actorRoleKey}
          initialRequirePlatformMfa={props.initialRequirePlatformMfa}
          initialPersonalMfaEnabled={props.initialPersonalMfaEnabled}
        />

        {canProvisionAdmins ? (
          <section className="card stack-md">
            <div className="stack-sm">
              <h2 className="title-md">Provision platform administrator</h2>
              <p className="muted">
                Grant internal <span className="mono">platform_admin</span> access to an existing
                verified user account.
              </p>
            </div>

            {errorMessage ? (
              <div className="banner banner-error" role="alert">
                {errorMessage}
              </div>
            ) : null}

            {successMessage ? (
              <div className="banner banner-success" role="status">
                {successMessage}
              </div>
            ) : null}

            <form className="stack-md" onSubmit={handleProvisionSubmit}>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: '1 1 260px' }}>
                  <label className="label" htmlFor="provision-admin-email">
                    Verified user email
                  </label>
                  <input
                    id="provision-admin-email"
                    name="email"
                    type="email"
                    className="input"
                    required
                    placeholder="operator@example.com"
                    value={targetEmail}
                    onChange={(event) => setTargetEmail(event.target.value)}
                  />
                </div>

                <div className="field" style={{ flex: '1 1 220px' }}>
                  <label className="label" htmlFor="provision-admin-reason">
                    Reason (optional)
                  </label>
                  <input
                    id="provision-admin-reason"
                    name="reason"
                    type="text"
                    className="input"
                    placeholder="Operations onboarding"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>

                <button type="submit" className="btn btn-primary" disabled={isPending}>
                  {isPending ? 'Provisioning…' : 'Provision platform admin'}
                </button>
              </div>
            </form>
          </section>
        ) : null}

        <section className="card stack-md">
          <div className="stack-sm">
            <h2 className="title-md">Platform administrators</h2>
            <p className="muted">Active and historical internal platform administrator roster.</p>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>MFA</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => (
                  <tr key={admin.assignmentId}>
                    <td>{admin.name}</td>
                    <td className="mono">{admin.email}</td>
                    <td>
                      <span className="badge">{admin.roleKey}</span>
                    </td>
                    <td>{admin.status}</td>
                    <td>{admin.mfaEnabled ? 'Enabled' : 'Pending'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
