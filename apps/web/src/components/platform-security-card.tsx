'use client';

import type {
  ApiErrorEnvelope,
  PlatformRoleKey,
  PlatformSecuritySettingsDto,
} from '@alias/contracts';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { PasswordInput } from './password-input';

interface EnrollmentSecrets {
  totpURI: string;
  secret: string;
  backupCodes: string[];
}

function extractTotpSecret(totpURI: string): string {
  try {
    const parsed = new URL(totpURI);
    return parsed.searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

export function PlatformSecurityCard(props: {
  actorRoleKey: PlatformRoleKey;
  initialRequirePlatformMfa: boolean;
  initialPersonalMfaEnabled: boolean;
}) {
  const router = useRouter();
  const [requirePlatformMfa, setRequirePlatformMfa] = useState(props.initialRequirePlatformMfa);
  const [personalMfaEnabled, setPersonalMfaEnabled] = useState(props.initialPersonalMfaEnabled);

  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policySuccess, setPolicySuccess] = useState<string | null>(null);
  const [isPolicyPending, setIsPolicyPending] = useState(false);

  const [enablePassword, setEnablePassword] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [enrollmentSecrets, setEnrollmentSecrets] = useState<EnrollmentSecrets | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [personalError, setPersonalError] = useState<string | null>(null);
  const [personalSuccess, setPersonalSuccess] = useState<string | null>(null);
  const [isPersonalPending, setIsPersonalPending] = useState(false);

  useEffect(() => {
    setRequirePlatformMfa(props.initialRequirePlatformMfa);
  }, [props.initialRequirePlatformMfa]);

  useEffect(() => {
    setPersonalMfaEnabled(props.initialPersonalMfaEnabled);
  }, [props.initialPersonalMfaEnabled]);

  const isSuperAdmin = props.actorRoleKey === 'super_admin';

  async function handleTogglePlatformMfa() {
    setPolicyError(null);
    setPolicySuccess(null);
    setIsPolicyPending(true);

    const nextValue = !requirePlatformMfa;
    try {
      const response = await fetch('/api/v1/platform/security-settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requirePlatformMfa: nextValue,
        }),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as ApiErrorEnvelope | null;
        setPolicyError(errorBody?.error.message ?? 'Unable to update platform 2FA policy.');
        return;
      }

      const payload = (await response.json()) as PlatformSecuritySettingsDto;
      setRequirePlatformMfa(payload.requirePlatformMfa);
      setPolicySuccess(
        payload.requirePlatformMfa
          ? 'Platform-wide 2FA requirement is now ON.'
          : 'Platform-wide 2FA requirement is now OFF.',
      );
      router.refresh();
    } catch {
      setPolicyError('Unexpected error while updating platform 2FA policy.');
    } finally {
      setIsPolicyPending(false);
    }
  }

  async function handlePersonalEnableSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPersonalError(null);
    setPersonalSuccess(null);
    setIsPersonalPending(true);

    try {
      const result = await authClient.twoFactor.enable({
        password: enablePassword,
      });

      if (result.error || !result.data) {
        setPersonalError(result.error?.message ?? 'Unable to start personal 2FA setup.');
        return;
      }

      const data = result.data as { totpURI?: string; backupCodes?: string[] };
      if (!data.totpURI) {
        setPersonalError('Personal 2FA setup did not return an otpauth URI.');
        return;
      }

      setEnrollmentSecrets({
        totpURI: data.totpURI,
        secret: extractTotpSecret(data.totpURI),
        backupCodes: data.backupCodes ?? [],
      });
      setEnablePassword('');
    } catch {
      setPersonalError('Unexpected error starting personal 2FA setup.');
    } finally {
      setIsPersonalPending(false);
    }
  }

  async function handlePersonalVerifySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPersonalError(null);
    setPersonalSuccess(null);
    setIsPersonalPending(true);

    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: totpCode.trim(),
      });

      if (result.error) {
        setPersonalError(result.error.message ?? 'Invalid 6-digit TOTP code.');
        return;
      }

      setPersonalMfaEnabled(true);
      setEnrollmentSecrets(null);
      setTotpCode('');
      setPersonalSuccess('Your personal 2FA authenticator is now enabled.');
      router.refresh();
    } catch {
      setPersonalError('Unexpected error verifying personal 2FA code.');
    } finally {
      setIsPersonalPending(false);
    }
  }

  async function handlePersonalDisableSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPersonalError(null);
    setPersonalSuccess(null);
    setIsPersonalPending(true);

    try {
      const result = await authClient.twoFactor.disable({
        password: disablePassword,
      });

      if (result.error) {
        setPersonalError(result.error.message ?? 'Unable to disable personal 2FA.');
        return;
      }

      setPersonalMfaEnabled(false);
      setDisablePassword('');
      setPersonalSuccess('Your personal 2FA authenticator has been disabled.');
      router.refresh();
    } catch {
      setPersonalError('Unexpected error disabling personal 2FA.');
    } finally {
      setIsPersonalPending(false);
    }
  }

  return (
    <section className="card stack-md">
      <div className="row row-between">
        <div className="stack-sm">
          <h2 className="title-md">Platform Security &amp; 2FA</h2>
          <p className="muted">
            Control whether multi-factor authentication is enforced across all platform
            administrators.
          </p>
        </div>
        <span
          className={requirePlatformMfa ? 'badge badge-accent' : 'badge badge-warning'}
          data-testid="platform-mfa-policy-status"
        >
          {requirePlatformMfa ? 'Required (ON)' : 'Optional (OFF)'}
        </span>
      </div>

      {!requirePlatformMfa ? (
        <div className="banner banner-warning" data-testid="platform-mfa-off-warning">
          Platform-wide 2FA requirement is currently OFF. Admins can access the platform console
          without personal 2FA until enforced.
        </div>
      ) : null}

      {policyError ? (
        <div className="banner banner-error" role="alert" data-testid="platform-security-error">
          {policyError}
        </div>
      ) : null}

      {policySuccess ? (
        <div
          className="banner banner-success"
          role="status"
          data-testid="platform-security-success"
        >
          {policySuccess}
        </div>
      ) : null}

      {isSuperAdmin ? (
        <div className="row">
          <button
            type="button"
            className={requirePlatformMfa ? 'btn btn-secondary' : 'btn btn-primary'}
            data-testid="toggle-platform-mfa-btn"
            disabled={isPolicyPending}
            onClick={handleTogglePlatformMfa}
          >
            {isPolicyPending
              ? 'Updating policy…'
              : requirePlatformMfa
                ? 'Turn OFF platform 2FA requirement'
                : 'Turn ON platform 2FA requirement'}
          </button>
        </div>
      ) : (
        <p className="muted small" data-testid="platform-mfa-readonly-note">
          Read-only: only a <span className="mono">super_admin</span> can toggle the platform-wide
          2FA requirement.
        </p>
      )}

      <div className="subcard stack-md">
        <div className="row row-between">
          <div className="stack-sm">
            <h3 className="title-md" style={{ fontSize: '1.05rem' }}>
              Your Personal 2FA
            </h3>
            <p className="muted small">
              Manage TOTP authenticator enrollment for your own administrator account.
            </p>
          </div>
          <span
            className={personalMfaEnabled ? 'badge badge-accent' : 'badge'}
            data-testid="personal-mfa-status"
          >
            {personalMfaEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        {personalError ? (
          <div className="banner banner-error" role="alert" data-testid="personal-mfa-error">
            {personalError}
          </div>
        ) : null}

        {personalSuccess ? (
          <div className="banner banner-success" role="status" data-testid="personal-mfa-success">
            {personalSuccess}
          </div>
        ) : null}

        {!personalMfaEnabled ? (
          enrollmentSecrets ? (
            <div className="stack-md">
              <div className="stack-sm">
                <span className="label">Manual Base32 secret</span>
                <div className="code-box mono" data-testid="personal-totp-secret">
                  {enrollmentSecrets.secret}
                </div>
              </div>

              <div className="stack-sm">
                <span className="label">Authenticator URI</span>
                <div className="code-box mono" data-testid="personal-totp-uri">
                  {enrollmentSecrets.totpURI}
                </div>
              </div>

              {enrollmentSecrets.backupCodes.length > 0 ? (
                <div className="stack-sm">
                  <span className="label">Backup recovery codes (save once)</span>
                  <ul className="backup-grid mono" data-testid="personal-backup-codes">
                    {enrollmentSecrets.backupCodes.map((code) => (
                      <li key={code}>{code}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <form className="stack-md" onSubmit={handlePersonalVerifySubmit}>
                <div className="field" style={{ maxWidth: '320px' }}>
                  <label className="label" htmlFor="personal-mfa-verify-code">
                    Enter 6-digit code from your authenticator
                  </label>
                  <input
                    id="personal-mfa-verify-code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    className="input mono"
                    required
                    placeholder="123456"
                    value={totpCode}
                    onChange={(event) => setTotpCode(event.target.value)}
                  />
                </div>

                <div className="row">
                  <button type="submit" className="btn btn-primary" disabled={isPersonalPending}>
                    {isPersonalPending ? 'Verifying…' : 'Verify & enable personal 2FA'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <form className="stack-md" onSubmit={handlePersonalEnableSubmit}>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: '1 1 280px', maxWidth: '360px' }}>
                  <label className="label" htmlFor="personal-mfa-enable-password">
                    Confirm password to set up personal 2FA
                  </label>
                  <PasswordInput
                    id="personal-mfa-enable-password"
                    name="password"
                    required
                    autoComplete="current-password"
                    value={enablePassword}
                    onChange={(event) => setEnablePassword(event.target.value)}
                  />
                </div>

                <button type="submit" className="btn btn-secondary" disabled={isPersonalPending}>
                  {isPersonalPending ? 'Generating…' : 'Set up personal 2FA'}
                </button>
              </div>
            </form>
          )
        ) : requirePlatformMfa ? (
          <p className="muted small" data-testid="personal-mfa-locked-note">
            Platform-wide 2FA is currently required. Turn OFF the platform-wide 2FA requirement
            before disabling your personal 2FA.
          </p>
        ) : (
          <form className="stack-md" onSubmit={handlePersonalDisableSubmit}>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 280px', maxWidth: '360px' }}>
                <label className="label" htmlFor="personal-mfa-disable-password">
                  Confirm password to disable personal 2FA
                </label>
                <PasswordInput
                  id="personal-mfa-disable-password"
                  name="password"
                  required
                  autoComplete="current-password"
                  value={disablePassword}
                  onChange={(event) => setDisablePassword(event.target.value)}
                />
              </div>

              <button type="submit" className="btn btn-secondary" disabled={isPersonalPending}>
                {isPersonalPending ? 'Disabling…' : 'Disable personal 2FA'}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
