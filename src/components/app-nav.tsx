'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/client-auth';

type AppNavProps = {
  active?: 'home' | 'dashboard' | 'minds' | 'vault' | 'settings' | 'login';
};

/**
 * Global search box. Isolated into its own component (and wrapped in Suspense
 * by AppNav) because useSearchParams() triggers a static-generation bailout —
 * keeping it here means /login and / can still be prerendered.
 */
function NavSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearchQuery(searchParams.get('q') ?? '');
  }, [searchParams]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      if (event.key === '/') {
        const target = event.target as HTMLElement | null;
        const isTyping = Boolean(
          target &&
            (target.tagName === 'INPUT' ||
              target.tagName === 'TEXTAREA' ||
              target.tagName === 'SELECT' ||
              target.isContentEditable),
        );
        if (!isTyping) {
          event.preventDefault();
          searchInputRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const updateSearch = (next: string) => {
    setSearchQuery(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) params.set('q', next);
    else params.delete('q');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <label className="nav-search">
      <span className="sr-only">Search MuttMind</span>
      <span className="nav-search__icon" aria-hidden="true">⌕</span>
      <input
        ref={searchInputRef}
        type="search"
        className="nav-search__input"
        placeholder="Search MuttMind"
        value={searchQuery}
        onChange={(e) => updateSearch(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {!searchQuery ? <span className="nav-search__hint" aria-hidden="true">⌘K</span> : null}
    </label>
  );
}

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

      {isAuthed ? (
        <Suspense fallback={<span className="nav-search" aria-hidden="true" />}>
          <NavSearch />
        </Suspense>
      ) : null}

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
              <span className="nav-num">01</span> Dashboard
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
