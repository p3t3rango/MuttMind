'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { getSupabaseBrowser } from '@/lib/client-auth';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [nextPath, setNextPath] = useState('/dashboard');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedNext = params.get('next');
    if (requestedNext?.startsWith('/')) {
      setNextPath(requestedNext);
      if (requestedNext.startsWith('/invite/')) setMode('signup');
    }

    getSupabaseBrowser().auth.getSession().then(({ data }) => {
      if (data.session) router.replace(requestedNext?.startsWith('/') ? requestedNext : '/dashboard');
    });
  }, [router]);

  async function signUp(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setMessage('');
    const normalizedEmail = email.trim().toLowerCase();
    const cleanDisplayName = displayName.trim();

    if (!normalizedEmail || !password) {
      setMessage('Email and password are required.');
      return;
    }

    if (password.length < 8) {
      setMessage('Use at least 8 characters for your password.');
      return;
    }

    if (password !== confirmPassword) {
      setMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    const redirectTo = `${window.location.origin}${nextPath}`;
    const { data, error } = await getSupabaseBrowser().auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: cleanDisplayName ? { display_name: cleanDisplayName, name: cleanDisplayName } : undefined,
      },
    });
    setIsSubmitting(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    if (data.session) {
      router.replace(nextPath);
      return;
    }

    setConfirmationEmail(normalizedEmail);
    setDisplayName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setMessage(
      nextPath.startsWith('/invite/')
        ? 'Account created. Check your email, then return to this invite link to join the Shared Mind.'
        : 'Account created. Check your email to confirm your login.',
    );
  }

  async function signIn(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setMessage('');
    setIsSubmitting(true);
    const { error } = await getSupabaseBrowser().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setIsSubmitting(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    router.replace(nextPath);
  }

  return (
    <main className="app-shell auth-shell">
      <AppNav active="login" />

      <section className="auth-page" aria-labelledby="login-title">
        <header className="auth-page__head">
          <p className="auth-page__crumb">
            {nextPath.startsWith('/invite/') ? 'invite · sign up to join' : 'account'}
          </p>
          <h1 id="login-title" className="auth-page__title">
            {confirmationEmail ? 'Check your email' : mode === 'signin' ? 'Sign in to MuttMind' : 'Create your account'}
          </h1>
        </header>

        {confirmationEmail ? (
          <div className="auth-confirm" role="status">
            <p className="auth-confirm__body">
              We sent a confirmation link to <span className="auth-confirm__email">{confirmationEmail}</span>.
            </p>
            {message ? <p className="auth-confirm__hint">{message}</p> : null}
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setConfirmationEmail('');
                setMode('signin');
                setMessage('');
              }}
            >
              ← Back to sign in
            </button>
          </div>
        ) : (
          <>
            <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                role="tab"
                className={`auth-tab ${mode === 'signin' ? 'auth-tab--active' : ''}`}
                onClick={() => {
                  setMode('signin');
                  setMessage('');
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                className={`auth-tab ${mode === 'signup' ? 'auth-tab--active' : ''}`}
                onClick={() => {
                  setMode('signup');
                  setMessage('');
                }}
              >
                Sign up
              </button>
            </div>

            <form className="auth-form" onSubmit={mode === 'signin' ? signIn : signUp}>
              {mode === 'signup' ? (
                <label className="auth-field">
                  <span className="auth-field__label">Name</span>
                  <input
                    type="text"
                    autoComplete="name"
                    placeholder="Your name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </label>
              ) : null}
              <label className="auth-field">
                <span className="auth-field__label">Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="auth-field">
                <span className="auth-field__label">Password</span>
                <input
                  type="password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {mode === 'signup' ? (
                <label className="auth-field">
                  <span className="auth-field__label">Confirm password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </label>
              ) : null}

              {message ? <p className="auth-error">{message}</p> : null}

              <button type="submit" className="auth-submit" disabled={isSubmitting}>
                {isSubmitting ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>

              {nextPath.startsWith('/invite/') ? (
                <p className="auth-hint">After signing in, this invite will open again so you can join the Shared Mind.</p>
              ) : null}
            </form>
          </>
        )}
      </section>
    </main>
  );
}
