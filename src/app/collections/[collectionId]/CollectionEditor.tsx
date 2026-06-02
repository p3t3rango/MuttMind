'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';
import { safeHttpHref } from '@/lib/safe-href';
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
  const [textDraft, setTextDraft] = useState('');
  const [addingText, setAddingText] = useState(false);
  const [textBusy, setTextBusy] = useState(false);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const [captionBusy, setCaptionBusy] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [members, setMembers] = useState<{ user_id: string; role: string; created_at: string }[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);

  const startEditCaption = (item: ItemWithNode) => {
    setEditingCaptionId(item.id);
    setCaptionDraft(item.caption ?? '');
  };

  const cancelCaption = () => {
    setEditingCaptionId(null);
    setCaptionDraft('');
  };

  const saveCaption = async (itemId: string) => {
    setCaptionBusy(true);
    const r = await authedFetch(`/api/collections/${collectionId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ caption: captionDraft || null }),
    });
    setCaptionBusy(false);
    if (!r.ok) {
      setStatus((await r.json()).error ?? 'Could not save caption.');
      return;
    }
    setItems((prev) => prev.map((it) => it.id === itemId ? { ...it, caption: captionDraft || null } : it));
    setEditingCaptionId(null);
    setCaptionDraft('');
    setStatus('Caption saved.');
  };

  const setCover = async (path: string | null) => {
    setCoverBusy(true);
    const r = await authedFetch(`/api/collections/${collectionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ coverPath: path }),
    });
    setCoverBusy(false);
    if (!r.ok) {
      setStatus((await r.json()).error ?? 'Could not set cover.');
      return;
    }
    const d = await r.json();
    setCollection(d.collection);
    setCoverPickerOpen(false);
    setStatus('Cover updated.');
  };

  const addTextBlock = async () => {
    if (textDraft.trim().length === 0) return;
    setTextBusy(true);
    const r = await authedFetch(`/api/collections/${collectionId}/items`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'text', textBody: textDraft }),
    });
    setTextBusy(false);
    if (!r.ok) {
      setStatus((await r.json()).error ?? 'Could not add.');
      return;
    }
    setTextDraft('');
    setAddingText(false);
    await load();
  };

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

  const loadMembers = useCallback(async () => {
    if (!isOwner) return;
    const r = await authedFetch(`/api/collections/${collectionId}/members`);
    if (!r.ok) return;
    const d = await r.json();
    setMembers(d.members ?? []);
  }, [collectionId, isOwner]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const invite = async () => {
    setInviteBusy(true);
    const r = await authedFetch(`/api/collections/${collectionId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email: inviteEmail }),
    });
    setInviteBusy(false);
    if (!r.ok) {
      setStatus((await r.json()).error ?? 'Could not invite.');
      return;
    }
    setInviteEmail('');
    setStatus('Editor invited.');
    await loadMembers();
  };

  const revoke = async (userId: string) => {
    if (!confirm('Remove this editor?')) return;
    const r = await authedFetch(`/api/collections/${collectionId}/members`, {
      method: 'DELETE',
      body: JSON.stringify({ userId }),
    });
    if (!r.ok) {
      setStatus((await r.json()).error ?? 'Could not revoke.');
      return;
    }
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    setStatus('Editor removed.');
  };

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

      <div className="ms-field">
        <label className="ms-field__label">Cover</label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {collection.coverPath ? (
            <>
              <img
                src={collection.coverPath}
                alt=""
                style={{ width: 96, height: 64, objectFit: 'cover', borderRadius: 4 }}
              />
            </>
          ) : (
            <div className="meta">No cover.</div>
          )}
          <button
            className="ms-btn ms-btn--ghost"
            onClick={() => setCoverPickerOpen(true)}
            disabled={coverBusy}
          >
            {collection.coverPath ? 'Change' : 'Set cover'}
          </button>
          {collection.coverPath && (
            <button
              className="ms-btn ms-btn--ghost"
              onClick={() => setCover(null)}
              disabled={coverBusy}
            >
              Clear
            </button>
          )}
        </div>
        {coverPickerOpen && (
          <div style={{ marginTop: 8 }}>
            <p className="meta">Pick from a capture image:</p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                gap: 8,
              }}
            >
              {items.flatMap((it) => {
                const opts: string[] = [];
                if (it.node?.og_image_url) opts.push(it.node.og_image_url);
                return opts.map((path) => (
                  <button
                    key={`${it.id}-${path}`}
                    onClick={() => setCover(path)}
                    disabled={coverBusy}
                    style={{
                      padding: 0,
                      border: '1px solid #2a2a2a',
                      borderRadius: 4,
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                    aria-label="Use as cover"
                  >
                    <img
                      src={path}
                      alt=""
                      style={{ width: '100%', height: 64, objectFit: 'cover', borderRadius: 4, display: 'block' }}
                    />
                  </button>
                ));
              })}
              {items.every((it) => !it.node?.og_image_url) && (
                <p className="meta" style={{ gridColumn: '1 / -1' }}>
                  No item images available. Add a capture that has an image, then come back.
                </p>
              )}
            </div>
            <button
              className="ms-btn ms-btn--ghost"
              onClick={() => setCoverPickerOpen(false)}
              style={{ marginTop: 8 }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {isOwner && (
        <div className="ms-field">
          <label className="ms-field__label">Editors</label>
          {members.length === 0 ? (
            <p className="meta">No co-editors yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {members.map((m) => (
                <li key={m.user_id} className="meta" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span style={{ fontFamily: 'monospace', opacity: 0.8 }}>{m.user_id}</span>
                  <button className="ms-btn ms-btn--ghost" onClick={() => revoke(m.user_id)}>Remove</button>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              className="ms-input"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="invite editor by email"
              style={{ flex: 1 }}
            />
            <button className="ms-btn" onClick={invite} disabled={inviteBusy || !inviteEmail}>
              {inviteBusy ? 'Inviting…' : 'Invite'}
            </button>
          </div>
        </div>
      )}

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
                    <CaptureItemView
                      item={it}
                      isEditingCaption={editingCaptionId === it.id}
                      captionDraft={captionDraft}
                      setCaptionDraft={setCaptionDraft}
                      startEditCaption={startEditCaption}
                      saveCaption={saveCaption}
                      cancelCaption={cancelCaption}
                      captionBusy={captionBusy}
                      onRemove={() => removeItem(it.id)}
                    />
                  ) : (
                    <TextBlockView item={it} onRemove={() => removeItem(it.id)} />
                  )}
                </SortableRow>
              ))}
            </ol>
          </SortableContext>
        </DndContext>

        <div style={{ marginTop: 24 }}>
          {!addingText && (
            <button className="ms-btn" onClick={() => setAddingText(true)}>
              + Add text block
            </button>
          )}
          {addingText && (
            <div className="ms-field">
              <textarea
                className="ms-input"
                rows={4}
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder="Heading, intro, or connective prose between items…"
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="ms-btn" onClick={addTextBlock} disabled={textBusy}>
                  {textBusy ? 'Adding…' : 'Save block'}
                </button>
                <button className="ms-btn ms-btn--ghost" onClick={() => { setAddingText(false); setTextDraft(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function CaptureItemView({
  item,
  isEditingCaption,
  captionDraft,
  setCaptionDraft,
  startEditCaption,
  saveCaption,
  cancelCaption,
  captionBusy,
  onRemove,
}: {
  item: ItemWithNode;
  isEditingCaption: boolean;
  captionDraft: string;
  setCaptionDraft: (v: string) => void;
  startEditCaption: (it: ItemWithNode) => void;
  saveCaption: (id: string) => void;
  cancelCaption: () => void;
  captionBusy: boolean;
  onRemove: () => void;
}) {
  const node = item.node;
  if (!node) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="meta" style={{ color: 'crimson' }}>(removed — keep or delete)</div>
        <button className="ms-btn ms-btn--ghost" onClick={onRemove}>Remove</button>
      </div>
    );
  }
  const safeUrl = safeHttpHref(node.original_url);
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
          {safeUrl ? (
            <a href={safeUrl} target="_blank" rel="noreferrer">
              {node.title ?? 'Untitled capture'}
            </a>
          ) : (
            <span>{node.title ?? 'Untitled capture'}</span>
          )}
        </div>

        {isEditingCaption ? (
          <div className="ms-field">
            <textarea
              className="ms-input"
              rows={3}
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              placeholder="Why this item belongs here, in this place…"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button className="ms-btn" onClick={() => saveCaption(item.id)} disabled={captionBusy}>
                {captionBusy ? 'Saving…' : 'Save caption'}
              </button>
              <button className="ms-btn ms-btn--ghost" onClick={cancelCaption}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {item.caption ? (
              <div style={{ whiteSpace: 'pre-wrap', marginBottom: 4 }}>{item.caption}</div>
            ) : (
              <div className="meta">No caption yet.</div>
            )}
            <div className="meta">
              <button className="ms-btn ms-btn--ghost" onClick={() => startEditCaption(item)}>
                Edit caption
              </button>
              {' · '}
              <button className="ms-btn ms-btn--ghost" onClick={onRemove}>Remove</button>
            </div>
          </>
        )}
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
