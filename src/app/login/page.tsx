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
    <main className="app-shell">
      <AppNav active="login" />

      <section className="login-shell" aria-labelledby="login-title">
        <div className="hero-copy">
          <div className="hero-content">
            <p className="eyebrow">§ Secure access / MuttMind entrance</p>
            <h1 id="login-title" className="auth-title">Sign in to MuttMind.</h1>
            <p className="lede">
              Use your account to reach your Mind, Smart Spaces, and Telegram capture flow.
            </p>
          </div>
          <div className="login-features" aria-label="Authenticated areas">
            <article className="login-feature">
              <span className="kicker">Mind</span>
              <p>Choose the personal or shared Mind you want to work in.</p>
            </article>
            <article className="login-feature">
              <span className="kicker">Smart Spaces</span>
              <p>Save filtered views that stay shared with the Mind.</p>
            </article>
            <article className="login-feature">
              <span className="kicker">Capture</span>
              <p>Save links, notes, and thumbnails as they arrive.</p>
            </article>
          </div>
        </div>

        <div className="panel login-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Account</p>
              <h2>{confirmationEmail ? 'Check your email' : mode === 'signin' ? 'Sign in' : 'Create account'}</h2>
            </div>
          </div>

          {confirmationEmail ? (
            <div className="auth-confirmation" role="status">
              <p className="kicker">Confirmation sent</p>
              <p className="lede">
                We sent a confirmation link to <span>{confirmationEmail}</span>.
              </p>
              <p className="meta">{message}</p>
              <button
                className="button-secondary"
                type="button"
                onClick={() => {
                  setConfirmationEmail('');
                  setMode('signin');
                  setMessage('');
                }}
              >
                Back to Sign In
              </button>
            </div>
          ) : (
            <>
              <div className="auth-mode-tabs" role="tablist" aria-label="Authentication mode">
                <button
                  type="button"
                  className={mode === 'signin' ? 'auth-mode-tab active' : 'auth-mode-tab'}
                  onClick={() => {
                    setMode('signin');
                    setMessage('');
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={mode === 'signup' ? 'auth-mode-tab active' : 'auth-mode-tab'}
                  onClick={() => {
                    setMode('signup');
                    setMessage('');
                  }}
                >
                  Sign up
                </button>
              </div>

              <form className="form-grid" onSubmit={mode === 'signin' ? signIn : signUp}>
                {mode === 'signup' ? (
                  <label className="form-row">
                    <span className="field-label">Name</span>
                    <input
                      type="text"
                      autoComplete="name"
                      placeholder="Your name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </label>
                ) : null}
                <label className="form-row">
                  <span className="field-label">Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="form-row">
                  <span className="field-label">Password</span>
                  <input
                    type="password"
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {mode === 'signup' ? (
                  <label className="form-row">
                    <span className="field-label">Confirm password</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder="Repeat password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </label>
                ) : null}
                <div className="button-row">
                  <button className="button" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Working' : mode === 'signin' ? 'Sign In' : 'Create Account'}
                  </button>
                  {mode === 'signin' ? (
                    <button className="button-secondary" type="button" onClick={() => setMode('signup')}>
                      Need an account?
                    </button>
                  ) : (
                    <button className="button-secondary" type="button" onClick={() => setMode('signin')}>
                      Already have one?
                    </button>
                  )}
                </div>
                {nextPath.startsWith('/invite/') ? (
                  <p className="meta">After signing in, this invite will open again so you can join the Shared Mind.</p>
                ) : null}
                <p className="status">{message}</p>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
