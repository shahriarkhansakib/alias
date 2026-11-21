'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { PasswordInput } from './password-input';

/** Seconds before "Send again" becomes available, after sign-up and after each resend. */
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Shown after sign-up. The email is sent in the background, so this page never knows whether
 * delivery worked; it shows the same message for everyone and offers to send the link again.
 * Delivery failures are logged by the API.
 */
function CheckYourEmail({ email }: { email: string }) {
  // A deadline rather than a decrementing counter, so the countdown stays right even when the
  // browser throttles timers in a background tab.
  const [availableAt, setAvailableAt] = useState(() => Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
  const [now, setNow] = useState(() => Date.now());
  const [isSending, setIsSending] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const secondsLeft = Math.max(0, Math.ceil((availableAt - now) / 1000));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function handleResend() {
    setIsSending(true);
    setResendNote(null);
    try {
      const result = await authClient.sendVerificationEmail({ email, callbackURL: '/dashboard' });
      setResendNote(
        result.error
          ? 'We could not send another link right now. Please try again in a moment.'
          : 'We sent another link. It can take a minute to arrive.',
      );
    } catch {
      setResendNote('We could not send another link right now. Please try again in a moment.');
    } finally {
      setIsSending(false);
      setAvailableAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
      setNow(Date.now());
    }
  }

  return (
    <div className="banner banner-success stack-sm" role="status">
      <strong>Check your email</strong>
      <span>
        We sent a verification link to <span className="mono">{email}</span>. Open the link to
        verify your address and continue.
      </span>
      <span className="small">Didn&apos;t get it? Check your spam folder, or send it again.</span>
      <div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleResend}
          disabled={isSending || secondsLeft > 0}
        >
          {isSending
            ? 'Sending…'
            : secondsLeft > 0
              ? `Send again (available in ${secondsLeft} s)`
              : 'Send again'}
        </button>
      </div>
      {resendNote ? (
        <span className="small" aria-live="polite">
          {resendNote}
        </span>
      ) : null}
    </div>
  );
}

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
        <CheckYourEmail email={submittedEmail} />
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
