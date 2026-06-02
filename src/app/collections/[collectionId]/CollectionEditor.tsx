'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';
import type { Collection, CollectionItem } from '@/lib/collections';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIndex = items.findIndex((i) => i.id === e.active.id);
    const newIndex = items.findIndex((i) => i.id === e.over!.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const prev = items;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next); // optimistic
    const r = await authedFetch(`/api/collections/${collectionId}/items`, {
      method: 'PATCH',
      body: JSON.stringify({ itemIds: next.map((i) => i.id) }),
    });
    if (!r.ok) {
      setStatus((await r.json()).error ?? 'Could not reorder.');
      setItems(prev); // revert
    }
  };

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

  const removeItem = async (itemId: string) => {
    if (!confirm('Remove this item from the Collection?')) return;
    const r = await authedFetch(`/api/collections/${collectionId}/items/${itemId}`, {
      method: 'DELETE',
    });
    if (!r.ok) {
      setStatus((await r.json()).error ?? 'Could not remove.');
      return;
    }
    setItems((prev) => prev.filter((it) => it.id !== itemId));
    setStatus('Removed.');
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

      <section style={{ marginTop: 24 }}>
        {items.length === 0 && (
          <p className="meta">
            No items yet. Open a capture in any Mind and choose &ldquo;Add to Collection,&rdquo; or use board multi-select.
          </p>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {items.map((it) => (
                <SortableRow key={it.id} id={it.id}>
                  {it.kind === 'capture' ? (
                    <CaptureItemView item={it} onRemove={() => removeItem(it.id)} />
                  ) : (
                    <TextBlockView item={it} onRemove={() => removeItem(it.id)} />
                  )}
                </SortableRow>
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </section>
    </>
  );
}

function CaptureItemView({
  item,
  onRemove,
}: { item: ItemWithNode; onRemove: () => void }) {
  const node = item.node;
  if (!node) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="meta" style={{ color: 'crimson' }}>(removed — keep or delete)</div>
        <button className="ms-btn ms-btn--ghost" onClick={onRemove}>Remove</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {node.og_image_url && (
        <img
          src={node.og_image_url}
          alt=""
          style={{ width: 96, height: 64, objectFit: 'cover', borderRadius: 4, flex: 'none' }}
        />
      )}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {node.original_url ? (
            <a href={node.original_url} target="_blank" rel="noreferrer">
              {node.title ?? 'Untitled capture'}
            </a>
          ) : (
            <span>{node.title ?? 'Untitled capture'}</span>
          )}
        </div>
        {item.caption && (
          <div style={{ whiteSpace: 'pre-wrap', marginBottom: 4 }}>
            {item.caption}
          </div>
        )}
        <div className="meta">
          <button className="ms-btn ms-btn--ghost" onClick={onRemove}>Remove</button>
        </div>
      </div>
    </div>
  );
}

function TextBlockView({
  item,
  onRemove,
}: { item: ItemWithNode; onRemove: () => void }) {
  return (
    <div>
      <div style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{item.textBody}</div>
      <button className="ms-btn ms-btn--ghost" onClick={onRemove}>Remove</button>
    </div>
  );
}

function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    padding: 12,
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
  };
  return (
    <li ref={setNodeRef} style={style}>
      <button
        type="button"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
        style={{
          cursor: 'grab',
          background: 'transparent',
          border: 'none',
          padding: '4px 6px',
          opacity: 0.6,
          flex: 'none',
        }}
      >
        ⋮⋮
      </button>
      <div style={{ flex: 1 }}>{children}</div>
    </li>
  );
}
