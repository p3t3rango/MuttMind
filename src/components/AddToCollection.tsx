'use client';

import { useEffect, useState } from 'react';
import { authedFetch } from '@/lib/client-auth';
import type { Collection } from '@/lib/collections';

export interface AddToCollectionProps {
  open: boolean;
  onClose: () => void;
  /** Called with the picked collection id and title — parent does the add. */
  onPick: (collectionId: string, title: string) => void;
}

export function AddToCollection({ open, onClose, onPick }: AddToCollectionProps) {
  const [owned, setOwned] = useState<Collection[]>([]);
  const [invited, setInvited] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch collections when the modal opens.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
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
  }, [open]);

  // Lock body scroll while open (matches new-mind-modal.tsx pattern).
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // ESC closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

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
    onPick(d.collection.id, d.collection.title);
  };

  return (
    <div className="mm-modal-backdrop" onClick={onClose} aria-hidden="false">
      <div
        className="mm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add to Collection"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mm-modal__header">
          <p className="mm-eyebrow">Add to Collection</p>
          <button type="button" className="mm-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="mm-modal__body">
          {loading && <p className="meta">Loading…</p>}
          {error && <p className="mm-error">{error}</p>}

          {!loading && (
            <>
              <div>
                <button
                  type="button"
                  className="mm-primary"
                  onClick={createNew}
                  disabled={creating}
                >
                  {creating ? 'Creating…' : '+ New Collection'}
                </button>
              </div>

              {owned.length > 0 && (
                <div>
                  <p className="mm-eyebrow" style={{ marginBottom: 8 }}>Yours</p>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {owned.map((c) => (
                      <li key={c.id} style={{ padding: '3px 0' }}>
                        <button
                          type="button"
                          className="mm-text-button"
                          onClick={() => onPick(c.id, c.title)}
                          style={{ textAlign: 'left', width: '100%' }}
                        >
                          {c.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {invited.length > 0 && (
                <div>
                  <p className="mm-eyebrow" style={{ marginBottom: 8 }}>Shared with you</p>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {invited.map((c) => (
                      <li key={c.id} style={{ padding: '3px 0' }}>
                        <button
                          type="button"
                          className="mm-text-button"
                          onClick={() => onPick(c.id, c.title)}
                          style={{ textAlign: 'left', width: '100%' }}
                        >
                          {c.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {owned.length === 0 && invited.length === 0 && (
                <p className="meta">No Collections yet — create one above.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AddToCollection;
