'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { getSupabaseBrowser } from '@/lib/client-auth';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    getSupabaseBrowser().auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/dashboard');
    });
  }, [router]);

  async function signUp() {
    const { error } = await getSupabaseBrowser().auth.signUp({ email, password });
    setMessage(error ? error.message : 'Signup successful. Check your email if confirmation is enabled.');
  }

  async function signIn() {
    const { error } = await getSupabaseBrowser().auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    router.replace('/dashboard');
  }

  return (
    <main className="app-shell">
      <AppNav active="login" />

      <section className="login-shell" aria-labelledby="login-title">
        <div className="hero-copy">
          <div className="hero-content">
            <p className="eyebrow">§ Secure access / MuttMind entrance</p>
            <h1 id="login-title" className="auth-title">Sign in to your workspace.</h1>
            <p className="lede">
              Use your account to reach the dashboard, vault, and Telegram capture flow.
            </p>
          </div>
          <div className="login-features" aria-label="Authenticated areas">
            <article className="login-feature">
              <span className="kicker">Workspace</span>
              <p>Choose the vault you want to work in.</p>
            </article>
            <article className="login-feature">
              <span className="kicker">Vault</span>
              <p>Review captures in list or graph view.</p>
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
              <h2>Sign in</h2>
            </div>
          </div>

          <div className="form-grid">
            <label className="form-row">
              <span className="field-label">Email</span>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="form-row">
              <span className="field-label">Password</span>
              <input
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <div className="button-row">
              <button className="button" onClick={signIn}>
                Sign In
              </button>
              <button className="button-secondary" onClick={signUp}>
                Sign Up
              </button>
            </div>
            <p className="status">{message}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
