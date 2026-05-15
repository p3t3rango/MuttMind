'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/client-auth';

type AppNavProps = {
  active?: 'home' | 'dashboard' | 'minds' | 'vault' | 'settings' | 'login';
};

export function AppNav({ active = 'home' }: AppNavProps) {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

  useEffect(() => {
    setMenuOpen(false);
  }, [active]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  async function signOut() {
    await getSupabaseBrowser().auth.signOut();
    window.location.href = '/login';
  }

  return (
    <header className={menuOpen ? 'topbar topbar--menu-open' : 'topbar'}>
      <Link href={homeHref} className="brand" aria-label="MuttMind home" onClick={() => setMenuOpen(false)}>
        <span className="brand-word">MuttMind</span>
      </Link>

      <button
        type="button"
        className="mobile-menu-button"
        aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={menuOpen}
        aria-controls="primary-navigation"
        onClick={() => setMenuOpen((current) => !current)}
      >
        <span className="mobile-menu-button__bars" aria-hidden="true" />
      </button>

      <nav id="primary-navigation" className="nav" aria-label="Primary navigation">
        {isAuthed ? (
          <>
            <Link
              href="/dashboard"
              className={active === 'dashboard' ? 'nav-link active' : 'nav-link'}
              onClick={() => setMenuOpen(false)}
            >
              <span className="nav-num">01</span> Mind
            </Link>
            <Link
              href="/minds"
              className={active === 'minds' ? 'nav-link active' : 'nav-link'}
              onClick={() => setMenuOpen(false)}
            >
              <span className="nav-num">02</span> Minds
            </Link>
            <Link
              href="/vault"
              className={active === 'vault' ? 'nav-link active' : 'nav-link'}
              onClick={() => setMenuOpen(false)}
            >
              <span className="nav-num">03</span> Map
            </Link>
            <Link
              href="/settings"
              className={active === 'settings' ? 'nav-link active' : 'nav-link'}
              onClick={() => setMenuOpen(false)}
            >
              <span className="nav-num">04</span> Settings
            </Link>
          </>
        ) : (
          <>
            <Link href="/" className={active === 'home' ? 'nav-link active' : 'nav-link'} onClick={() => setMenuOpen(false)}>
              <span className="nav-num">01</span> What
            </Link>
            <Link href="/login" className={active === 'login' ? 'nav-link active' : 'nav-link'} onClick={() => setMenuOpen(false)}>
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
