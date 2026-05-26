'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';
import type { SearchGroup } from '@/lib/search';

function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get('q') ?? '';
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setGroups([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const r = await authedFetch(`/api/search?q=${encodeURIComponent(term)}`);
      const d = await r.json();
      if (!cancelled) {
        setGroups(r.ok ? (d.groups ?? []) : []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q]);

  const openCapture = (mindId: string, captureId: string) => {
    window.localStorage.setItem('muttmind:focus-capture-id', captureId);
    router.push(`/minds/${mindId}`);
  };

  const total = groups.reduce((n, g) => n + g.captures.length + g.insights.length, 0);

  return (
    <main className="app-shell">
      <AppNav active="minds" />
      <section className="search-page">
        <p className="search-page__crumb">
          {q.trim()
            ? loading
              ? 'Searching all Minds…'
              : `${total} result${total === 1 ? '' : 's'} for "${q.trim()}" across your Minds`
            : 'Type to search across all your Minds.'}
        </p>

        {!loading && q.trim() && total === 0 ? (
          <p className="search-page__empty">Nothing matched. Try a different term.</p>
        ) : null}

        {groups.map((g) => (
          <section key={g.mindId} className="search-group">
            <div className="search-group__head">
              <Link href={`/minds/${g.mindId}`} className="search-group__mind">{g.mindName}</Link>
              <span className="search-group__count">
                {g.captures.length + g.insights.length}
              </span>
            </div>
            <ul className="search-list" role="list">
              {g.captures.map((c) => (
                <li key={c.id}>
                  <button type="button" className="search-hit" onClick={() => openCapture(g.mindId, c.id)}>
                    <span className="search-hit__kind">capture</span>
                    <span className="search-hit__title">{c.title ?? c.url ?? 'Untitled'}</span>
                    {c.summary ? <span className="search-hit__sub">{c.summary.slice(0, 120)}</span> : null}
                  </button>
                </li>
              ))}
              {g.insights.map((i) => (
                <li key={i.id}>
                  <Link href={`/minds/${g.mindId}/insights`} className="search-hit">
                    <span className="search-hit__kind">insight</span>
                    <span className="search-hit__title">{i.title ?? 'Insight'}</span>
                    <span className="search-hit__sub">{i.snippet}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
    </main>
  );
}

export default function SearchPage() {
  return (
    <AuthGate>
      <Suspense>
        <SearchResults />
      </Suspense>
    </AuthGate>
  );
}
