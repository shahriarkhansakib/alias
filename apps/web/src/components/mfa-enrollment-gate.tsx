'use client';

import type { PlatformRoleKey } from '@alias/contracts';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { PasswordInput } from './password-input';
import { SignOutButton } from './sign-out-button';

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

export function MfaEnrollmentGate(props: { email: string; roleKey: PlatformRoleKey }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [secrets, setSecrets] = useState<EnrollmentSecrets | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleEnableSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsPending(true);

    try {
      const result = await authClient.twoFactor.enable({
        password,
      });

      if (result.error || !result.data) {
        setErrorMessage(result.error?.message ?? 'Unable to start MFA enrollment.');
        return;
      }

      const data = result.data as { totpURI?: string; backupCodes?: string[] };
      if (!data.totpURI) {
        setErrorMessage('MFA setup did not return an otpauth URI.');
        return;
      }

      setSecrets({
        totpURI: data.totpURI,
        secret: extractTotpSecret(data.totpURI),
        backupCodes: data.backupCodes ?? [],
      });
    } catch {
      setErrorMessage('Unexpected error starting MFA enrollment.');
    } finally {
      setIsPending(false);
    }
  }

  async function handleVerifySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsPending(true);

    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: totpCode.trim(),
      });

      if (result.error) {
        setErrorMessage(result.error.message ?? 'Invalid 6-digit TOTP code.');
        return;
      }

      router.refresh();
    } catch {
      setErrorMessage('Unexpected error verifying TOTP code.');
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
            <span className="badge">{props.roleKey}</span>
          </div>
          <div className="topbar-actions">
            <span className="muted small">{props.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="center-main">
        <div className="card auth-card stack-lg">
          <div className="stack-sm">
            <h1 className="title-md">Multi-factor authentication required</h1>
            <p className="muted">
              Platform administrators must enroll and verify a TOTP authenticator before accessing
              platform operations.
            </p>
          </div>

          {errorMessage ? (
            <div className="banner banner-error" role="alert">
              {errorMessage}
            </div>
          ) : null}

          {!secrets ? (
            <form className="stack-md" onSubmit={handleEnableSubmit}>
              <div className="field">
                <label className="label" htmlFor="mfa-enable-password">
                  Confirm your password to generate TOTP credentials
                </label>
                <PasswordInput
                  id="mfa-enable-password"
                  name="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              <button type="submit" className="btn btn-primary" disabled={isPending}>
                {isPending ? 'Generating credentials…' : 'Begin MFA enrollment'}
              </button>
            </form>
          ) : (
            <div className="stack-lg">
              <div className="stack-sm">
                <span className="label">Manual Base32 secret</span>
                <div className="code-box mono" data-testid="totp-secret">
                  {secrets.secret}
                </div>
              </div>

              <div className="stack-sm">
                <span className="label">Authenticator URI</span>
                <div className="code-box mono" data-testid="totp-uri">
                  {secrets.totpURI}
                </div>
              </div>

              {secrets.backupCodes.length > 0 ? (
                <div className="stack-sm">
                  <span className="label">Backup recovery codes (save once)</span>
                  <ul className="backup-grid mono" data-testid="backup-codes">
                    {secrets.backupCodes.map((code) => (
                      <li key={code}>{code}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <form className="stack-md" onSubmit={handleVerifySubmit}>
                <div className="field">
                  <label className="label" htmlFor="mfa-verify-code">
                    Enter 6-digit code from your authenticator
                  </label>
                  <input
                    id="mfa-verify-code"
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

                <button type="submit" className="btn btn-primary" disabled={isPending}>
                  {isPending ? 'Verifying…' : 'Verify & unlock platform admin'}
                </button>
              </form>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
