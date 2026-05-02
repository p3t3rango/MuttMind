'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/client-auth';

type AppNavProps = {
  active?: 'home' | 'dashboard' | 'spaces' | 'vault' | 'settings' | 'login';
};

export function AppNav({ active = 'home' }: AppNavProps) {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const homeHref = isAuthed ? '/dashboard' : '/';

  useEffect(() => {
    getSupabaseBrowser().auth.getSession().then(({ data }) => {
      setIsAuthed(Boolean(data.session));
      setIsLoaded(true);
    });

    const {
      data: { subscription },
    } = getSupabaseBrowser().auth.onAuthStateChange((_event, session) => {
      setIsAuthed(Boolean(session));
      setIsLoaded(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    await getSupabaseBrowser().auth.signOut();
    window.location.href = '/login';
  }

  return (
    <header className="topbar">
      <Link href={homeHref} className="brand" aria-label="MuttMind home">
        <span className="brand-glyph">⌘</span>
        <span className="brand-word">MuttMind</span>
      </Link>

      <nav className="nav" aria-label="Primary navigation">
        {isAuthed ? (
          <>
            <Link
              href="/dashboard"
              className={active === 'dashboard' ? 'nav-link active' : 'nav-link'}
            >
              <span className="nav-num">01</span> Mind
            </Link>
            <Link href="/spaces" className={active === 'spaces' ? 'nav-link active' : 'nav-link'}>
              <span className="nav-num">02</span> Smart Spaces
            </Link>
            <Link href="/vault" className={active === 'vault' ? 'nav-link active' : 'nav-link'}>
              <span className="nav-num">03</span> Map
            </Link>
            <Link
              href="/settings"
              className={active === 'settings' ? 'nav-link active' : 'nav-link'}
            >
              <span className="nav-num">04</span> Settings
            </Link>
          </>
        ) : (
          <>
            <Link href="/" className={active === 'home' ? 'nav-link active' : 'nav-link'}>
              <span className="nav-num">01</span> What
            </Link>
            <Link href="/login" className={active === 'login' ? 'nav-link active' : 'nav-link'}>
              <span className="nav-num">02</span> Login
            </Link>
          </>
        )}
      </nav>

      <div className="nav-meta" aria-live="polite">
        {isLoaded && isAuthed ? (
          <button className="nav-signout" onClick={signOut}>
            Sign out
          </button>
        ) : null}
      </div>
    </header>
  );
}
