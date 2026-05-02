'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';

type SmartSpace = {
  id: string;
  name: string;
  query: string;
  workspaceId: string;
  color: string;
  createdAt: string;
};

const SMART_SPACES_KEY = 'muttmind:smart-spaces';

function loadStoredSpaces() {
  try {
    return JSON.parse(window.localStorage.getItem(SMART_SPACES_KEY) ?? '[]') as SmartSpace[];
  } catch {
    return [];
  }
}

function SpacesContent() {
  const router = useRouter();
  const [spaces, setSpaces] = useState<SmartSpace[]>([]);
  const [queryDraft, setQueryDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    setSpaces(loadStoredSpaces());
  }, []);

  const persistSpaces = (nextSpaces: SmartSpace[]) => {
    setSpaces(nextSpaces);
    window.localStorage.setItem(SMART_SPACES_KEY, JSON.stringify(nextSpaces));
  };

  const createSpace = () => {
    const query = queryDraft.trim();
    const name = nameDraft.trim() || query;
    if (!query || !name) {
      setStatus('Add a search like #music, type:video, or site:example.com.');
      return;
    }

    const nextSpace: SmartSpace = {
      id: window.crypto.randomUUID(),
      name,
      query,
      workspaceId: 'all',
      color: '#7c3aed',
      createdAt: new Date().toISOString(),
    };
    persistSpaces([nextSpace, ...spaces]);
    setQueryDraft('');
    setNameDraft('');
    setStatus('Smart Space saved.');
  };

  const openSpace = (space: SmartSpace) => {
    window.localStorage.setItem('muttmind:active-space-query', space.query);
    router.push('/dashboard');
  };

  const deleteSpace = (spaceId: string) => {
    persistSpaces(spaces.filter((space) => space.id !== spaceId));
  };

  return (
    <main className="app-shell mind-shell">
      <AppNav active="spaces" />

      <section className="spaces-page" aria-labelledby="spaces-title">
        <div className="spaces-page__header">
          <div>
            <p className="eyebrow">Saved searches</p>
            <h1 id="spaces-title">Spaces</h1>
          </div>
          <div className="spaces-page__create" aria-label="Create Smart Space">
            <input
              aria-label="Smart Space name"
              placeholder="Name"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
            />
            <input
              aria-label="Smart Space query"
              placeholder="#tag, type:image, site:example.com"
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') createSpace();
              }}
            />
            <button className="button" onClick={createSpace}>
              Create Smart Space
            </button>
          </div>
        </div>

        <p className="status">{status || 'Smart Spaces are live filters. Save a search once, then reopen that view anytime.'}</p>

        {spaces.length ? (
          <div className="spaces-grid">
            {spaces.map((space) => (
              <article key={space.id} className="space-card">
                <button className="space-card__main" onClick={() => openSpace(space)}>
                  <span className="space-card__dot" style={{ borderColor: space.color }} />
                  <span className="space-card__name">{space.name}</span>
                  <span className="space-card__query">{space.query}</span>
                </button>
                <button className="space-card__delete" onClick={() => deleteSpace(space.id)}>
                  Delete
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="mind-empty">
            <h2>No Spaces yet.</h2>
            <p>Try saving searches like #creative-direction, type:video, or site:peterarango.com.</p>
          </div>
        )}
      </section>
    </main>
  );
}

export default function SpacesPage() {
  return (
    <AuthGate>
      <SpacesContent />
    </AuthGate>
  );
}
