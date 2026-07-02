'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { AddToCollection } from '@/components/AddToCollection';
import { authedFetch } from '@/lib/client-auth';
import { COLLECTIONS_ENABLED } from '@/lib/features';
import type { SearchGroup } from '@/lib/search';

function ResultRowAddAction({
  nodeId,
  setBanner,
}: {
  nodeId: string;
  setBanner: (s: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const onPick = async (collectionId: string, title: string) => {
    setBusy(true);
    const r = await authedFetch(`/api/collections/${collectionId}/items`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'capture', nodeId }),
    });
    setBusy(false);
    setOpen(false);
    if (!r.ok) {
      setBanner((await r.json()).error ?? 'Could not add to Collection.');
      return;
    }
    setBanner(`Added to "${title}".`);
  };

  return (
    <>
      <button
        type="button"
        className="ms-btn ms-btn--ghost"
        onClick={() => setOpen(true)}
        disabled={busy}
        style={{ marginTop: 4 }}
      >
        Add to Collection
      </button>
      <AddToCollection open={open} onClose={() => setOpen(false)} onPick={onPick} />
    </>
  );
}

function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get('q') ?? '';
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setGroups([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await authedFetch(`/api/search?q=${encodeURIComponent(term)}`);
        const d = await r.json();
        if (!cancelled) setGroups(r.ok ? (d.groups ?? []) : []);
      } catch {
        if (!cancelled) setGroups([]);
      } finally {
        if (!cancelled) setLoading(false);
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

        {banner && (
          <p
            className="search-page__banner"
            style={{ marginBottom: 12 }}
            onClick={() => setBanner(null)}
            role="status"
          >
            {banner}
          </p>
        )}

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
                <li key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <button type="button" className="search-hit" onClick={() => openCapture(g.mindId, c.id)} style={{ flex: 1 }}>
                    <span className="search-hit__kind">capture</span>
                    <span className="search-hit__title">{c.title ?? c.url ?? 'Untitled'}</span>
                    {c.summary ? <span className="search-hit__sub">{c.summary.slice(0, 120)}</span> : null}
                  </button>
                  {COLLECTIONS_ENABLED ? <ResultRowAddAction nodeId={c.id} setBanner={setBanner} /> : null}
                </li>
              ))}
              {g.insights.map((i) => (
                <li key={i.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <Link href={`/minds/${g.mindId}/insights`} className="search-hit" style={{ flex: 1 }}>
                    <span className="search-hit__kind">insight</span>
                    <span className="search-hit__title">{i.title ?? 'Insight'}</span>
                    <span className="search-hit__sub">{i.snippet}</span>
                  </Link>
                  {COLLECTIONS_ENABLED ? (
                    <span
                      className="meta"
                      title="Insight items aren't supported in Collections yet"
                      style={{ opacity: 0.6, marginTop: 4, whiteSpace: 'nowrap' }}
                    >
                      Add to Collection (insights unsupported)
                    </span>
                  ) : null}
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
