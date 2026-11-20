'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { PasswordInput } from './password-input';

export function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsPending(true);

    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        callbackURL: '/dashboard',
      });

      if (result.error) {
        setErrorMessage(result.error.message ?? 'Unable to create account.');
        return;
      }

      setSubmittedEmail(email.trim().toLowerCase());
    } catch {
      setErrorMessage('Unexpected error while creating your account.');
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

      <div className="stack-sm">
        <h1 className="title-md">Create your Alias account</h1>
        <p className="muted">
          Register with your email address. Verification is required before signing in.
        </p>
      </div>

      {submittedEmail ? (
        <div className="banner banner-success stack-sm" role="status">
          <strong>Check your email</strong>
          <span>
            We sent a verification link to <span className="mono">{submittedEmail}</span>. Open the
            link to verify your address and continue.
          </span>
        </div>
      ) : (
        <form className="stack-md" onSubmit={handleSubmit}>
          {errorMessage ? (
            <div className="banner banner-error" role="alert">
              {errorMessage}
            </div>
          ) : null}

          <div className="field">
            <label className="label" htmlFor="register-name">
              Full name
            </label>
            <input
              id="register-name"
              name="name"
              type="text"
              className="input"
              required
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="register-email">
              Email address
            </label>
            <input
              id="register-email"
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
            <label className="label" htmlFor="register-password">
              Password
            </label>
            <PasswordInput
              id="register-password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={isPending}>
            {isPending ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      )}

      <p className="muted small">
        Already have an account?{' '}
        <Link href="/login" style={{ textDecoration: 'underline' }}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
