'use client';

import type { AccessContextResponse } from '@alias/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { PasswordInput } from './password-input';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function navigateByAccessContext() {
    const response = await fetch('/api/v1/access-context', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) {
      router.push('/dashboard');
      router.refresh();
      return;
    }

    const accessContext = (await response.json()) as AccessContextResponse;
    const destination = accessContext.principalType === 'admin' ? '/admin' : '/dashboard';
    router.push(destination);
    router.refresh();
  }

  async function handleCredentialSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsPending(true);

    try {
      const result = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });

      if (result.error) {
        setErrorMessage(result.error.message ?? 'Invalid email or password.');
        return;
      }

      const data = result.data as { twoFactorRedirect?: boolean } | null;
      if (data?.twoFactorRedirect) {
        setRequiresTwoFactor(true);
        setTwoFactorCode('');
        return;
      }

      await navigateByAccessContext();
    } catch {
      setErrorMessage('Unable to sign in right now.');
    } finally {
      setIsPending(false);
    }
  }

  async function handleTwoFactorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsPending(true);

    try {
      const trimmedCode = twoFactorCode.trim();
      const result = useBackupCode
        ? await authClient.twoFactor.verifyBackupCode({ code: trimmedCode })
        : await authClient.twoFactor.verifyTotp({ code: trimmedCode });

      if (result.error) {
        setErrorMessage(result.error.message ?? 'Invalid verification code.');
        return;
      }

      await navigateByAccessContext();
    } catch {
      setErrorMessage('Unable to verify two-factor code.');
    } finally {
      setIsPending(false);
    }
  }

  async function handleGoogleSignIn() {
    setErrorMessage(null);
    setIsPending(true);
    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/dashboard',
      });
      if (result.error) {
        setErrorMessage(result.error.message ?? 'Google sign-in is not configured.');
      }
    } catch {
      setErrorMessage('Unable to initiate Google sign-in.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="card auth-card stack-lg">
      <div>
        <Link href="/" className="btn btn-link">
          ← Back to home
        </Link>
      </div>

      {requiresTwoFactor ? (
        <>
          <div className="stack-sm">
            <h1 className="title-md">Two-factor verification</h1>
            <p className="muted">
              {useBackupCode
                ? 'Enter one of your one-time recovery backup codes.'
                : 'Enter the 6-digit code from your authenticator application.'}
            </p>
          </div>

          <form className="stack-md" onSubmit={handleTwoFactorSubmit}>
            {errorMessage ? (
              <div className="banner banner-error" role="alert">
                {errorMessage}
              </div>
            ) : null}

            <div className="field">
              <label className="label" htmlFor="two-factor-code">
                {useBackupCode ? 'Backup code' : '6-digit authenticator code'}
              </label>
              <input
                id="two-factor-code"
                name="code"
                type="text"
                inputMode={useBackupCode ? 'text' : 'numeric'}
                className="input mono"
                required
                autoComplete="one-time-code"
                placeholder={useBackupCode ? 'xxxxxxxxxx' : '123456'}
                value={twoFactorCode}
                onChange={(event) => setTwoFactorCode(event.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? 'Verifying…' : 'Verify and continue'}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              disabled={isPending}
              onClick={() => {
                setErrorMessage(null);
                setTwoFactorCode('');
                setUseBackupCode((current) => !current);
              }}
            >
              {useBackupCode ? 'Use authenticator code' : 'Use backup code'}
            </button>
          </form>
        </>
      ) : (
        <>
          <div className="stack-sm">
            <h1 className="title-md">Sign in to Alias</h1>
            <p className="muted">Enter your credentials to access your workspace.</p>
          </div>

          <form className="stack-md" onSubmit={handleCredentialSubmit}>
            {errorMessage ? (
              <div className="banner banner-error" role="alert">
                {errorMessage}
              </div>
            ) : null}

            <div className="field">
              <label className="label" htmlFor="login-email">
                Email address
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                className="input"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="login-password">
                Password
              </label>
              <PasswordInput
                id="login-password"
                name="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="divider">or</div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleGoogleSignIn}
            disabled={isPending}
          >
            Continue with Google
          </button>

          <p className="muted small">
            New to Alias?{' '}
            <Link href="/register" style={{ textDecoration: 'underline' }}>
              Create account
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
