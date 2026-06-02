'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';
import type { Collection } from '@/lib/collections';

export default function CollectionsHome() {
  return (
    <AuthGate>
      <CollectionsContent />
    </AuthGate>
  );
}

function CollectionsContent() {
  return (
    <main className="app-shell ms-shell">
      <AppNav active="collections" />
      <section className="ms-page">
        <CollectionsHomeBody />
      </section>
    </main>
  );
}

function CollectionsHomeBody() {
  const router = useRouter();
  const [owned, setOwned] = useState<Collection[]>([]);
  const [invited, setInvited] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await authedFetch('/api/collections');
      if (!r.ok) {
        setError((await r.json()).error ?? 'Failed to load.');
        setLoading(false);
        return;
      }
      const d = await r.json();
      setOwned(d.owned ?? []);
      setInvited(d.invited ?? []);
      setLoading(false);
    })();
  }, []);

  const createNew = async () => {
    setCreating(true);
    const r = await authedFetch('/api/collections', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setCreating(false);
    if (!r.ok) {
      setError((await r.json()).error ?? 'Could not create.');
      return;
    }
    const d = await r.json();
    router.push(`/collections/${d.collection.id}`);
  };

  return (
    <>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>Collections</h1>
        <button className="ms-btn" onClick={createNew} disabled={creating}>
          {creating ? 'Creating…' : 'New Collection'}
        </button>
      </header>

      {loading && <p className="meta">Loading…</p>}
      {error && <p className="meta" style={{ color: 'crimson' }}>{error}</p>}

      {!loading && owned.length === 0 && invited.length === 0 && (
        <p className="meta">No Collections yet. Start one to compose an authored thread from your captures.</p>
      )}

      {owned.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7, marginBottom: 12 }}>Yours</h2>
          <CollectionGrid items={owned} />
        </section>
      )}

      {invited.length > 0 && (
        <section>
          <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7, marginBottom: 12 }}>Shared with you</h2>
          <CollectionGrid items={invited} />
        </section>
      )}
    </>
  );
}

function CollectionGrid({ items }: { items: Collection[] }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
      {items.map((c) => (
        <li key={c.id}>
          <Link href={`/collections/${c.id}`} style={{ display: 'block', padding: 16, border: '1px solid #2a2a2a', borderRadius: 6, textDecoration: 'none', color: 'inherit', minHeight: 100 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{c.title}</div>
            {c.description && <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>{c.description}</div>}
            <div className="meta">{c.status === 'published' ? 'Published' : 'Draft'}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
