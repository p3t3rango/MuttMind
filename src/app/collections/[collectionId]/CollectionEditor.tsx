'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';
import type { Collection, CollectionItem } from '@/lib/collections';

interface NodeJoin {
  id: string;
  title: string | null;
  original_url: string | null;
  og_image_url: string | null;
  media_path: string | null;
  scrape_kind: string | null;
  published_at: string | null;
  created_at: string;
  created_by: string | null;
  workspace_id: string;
}

export interface ItemWithNode extends CollectionItem {
  node: NodeJoin | null;
}

export default function CollectionEditor({ collectionId }: { collectionId: string }) {
  return (
    <AuthGate>
      <main className="app-shell ms-shell">
        <AppNav active="collections" />
        <section className="ms-page">
          <EditorBody collectionId={collectionId} />
        </section>
      </main>
    </AuthGate>
  );
}

function EditorBody({ collectionId }: { collectionId: string }) {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<ItemWithNode[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  const load = useCallback(async () => {
    const r = await authedFetch(`/api/collections/${collectionId}`);
    if (!r.ok) {
      setStatus((await r.json()).error ?? 'Failed to load.');
      setLoading(false);
      return;
    }
    const d = await r.json();
    setCollection(d.collection);
    setItems(d.items ?? []);
    setIsOwner(!!d.isOwner);
    setTitleDraft(d.collection.title);
    setDescDraft(d.collection.description ?? '');
    setLoading(false);
  }, [collectionId]);

  useEffect(() => { load(); }, [load]);

  const saveMeta = async () => {
    if (!collection) return;
    setSavingMeta(true);
    const r = await authedFetch(`/api/collections/${collectionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: titleDraft, description: descDraft || null }),
    });
    setSavingMeta(false);
    if (!r.ok) {
      setStatus((await r.json()).error ?? 'Could not save.');
      return;
    }
    const d = await r.json();
    setCollection(d.collection);
    setStatus('Saved.');
  };

  if (loading) return <p className="meta">Loading…</p>;
  if (!collection) return <p className="meta" style={{ color: 'crimson' }}>{status ?? 'Not found.'}</p>;

  return (
    <>
      <header style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <input
          className="ms-input"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          placeholder="Untitled Collection"
          style={{ flex: 1, fontSize: 22, fontWeight: 600 }}
        />
        <button className="ms-btn" onClick={saveMeta} disabled={savingMeta}>
          {savingMeta ? 'Saving…' : 'Save'}
        </button>
      </header>

      <div className="ms-field">
        <label className="ms-field__label">Description</label>
        <textarea
          className="ms-input"
          rows={3}
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          placeholder="Short intro that sets up the Collection…"
        />
      </div>

      <p className="meta">
        Status: {collection.status === 'published' ? 'Published' : 'Draft'}
        {' · '}Editor role: {isOwner ? 'Owner' : 'Editor'}
      </p>

      {status && <p className="meta">{status}</p>}

      {/* Items list rendered in CC-15. */}
      <section data-section="items" />
    </>
  );
}
