'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';

type Mind = {
  role: string;
  workspaces: {
    id: string;
    name: string;
    member_count?: number;
  };
};

type SmartSpace = {
  id: string;
  name: string;
  query: string;
  workspaceId: string;
  color: string;
  createdAt: string;
  createdByLabel?: string;
};

function getMindLabel(mind: Mind | undefined) {
  if (!mind) return 'No Mind selected';
  return (mind.workspaces.member_count ?? 1) > 1 ? 'Shared Mind' : 'Mind';
}

function SpacesContent() {
  const router = useRouter();
  const [minds, setMinds] = useState<Mind[]>([]);
  const [mindId, setMindId] = useState('');
  const [spaces, setSpaces] = useState<SmartSpace[]>([]);
  const [queryDraft, setQueryDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [status, setStatus] = useState('');

  const currentMind = minds.find((mind) => mind.workspaces.id === mindId);

  const loadMinds = useCallback(async () => {
    const response = await authedFetch('/api/workspaces');
    const data = await response.json();
    const nextMinds = data.workspaces ?? [];
    setMinds(nextMinds);
    setMindId((current) => current || nextMinds[0]?.workspaces?.id || '');
  }, []);

  const loadSpaces = useCallback(async (nextMindId = mindId) => {
    if (!nextMindId) {
      setSpaces([]);
      return;
    }
    const response = await authedFetch(`/api/spaces?workspaceId=${nextMindId}`);
    const data = await response.json();
    setSpaces(data.spaces ?? []);
  }, [mindId]);

  useEffect(() => {
    loadMinds();
  }, [loadMinds]);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  const createSpace = async () => {
    const query = queryDraft.trim();
    const name = nameDraft.trim() || query;
    if (!mindId) {
      setStatus('Choose a Mind first.');
      return;
    }
    if (!query || !name) {
      setStatus('Add a search like #music, type:video, by:pete, or site:example.com.');
      return;
    }

    const response = await authedFetch('/api/spaces', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: mindId, name, query, color: '#7c3aed' }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error ?? 'Unable to save Smart Space.');
      return;
    }
    setQueryDraft('');
    setNameDraft('');
    setStatus('Smart Space saved for this Mind.');
    await loadSpaces();
  };

  const openSpace = (space: SmartSpace) => {
    window.localStorage.setItem('muttmind:active-space-query', space.query);
    window.localStorage.setItem('muttmind:active-mind-id', space.workspaceId);
    router.push('/dashboard');
  };

  const deleteSpace = async (spaceId: string) => {
    if (!mindId) return;
    const response = await authedFetch(`/api/spaces?workspaceId=${mindId}&spaceId=${spaceId}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error ?? 'Unable to delete Smart Space.');
      return;
    }
    await loadSpaces();
  };

  return (
    <main className="app-shell mind-shell">
      <AppNav active="spaces" />

      <section className="spaces-page" aria-labelledby="spaces-title">
        <div className="spaces-page__header">
          <div>
            <p className="eyebrow">{getMindLabel(currentMind)} / Saved filters</p>
            <h1 id="spaces-title">Smart Spaces</h1>
            <p className="lede">
              Save searches like tags, source domains, media types, or contributors as shared views for this Mind.
            </p>
          </div>
          <div className="spaces-page__create" aria-label="Create Smart Space">
            <select value={mindId} onChange={(event) => setMindId(event.target.value)} aria-label="Choose Mind">
              <option value="">Choose Mind</option>
              {minds.map((mind) => (
                <option key={mind.workspaces.id} value={mind.workspaces.id}>
                  {mind.workspaces.name} - {getMindLabel(mind)}
                </option>
              ))}
            </select>
            <input
              aria-label="Smart Space name"
              placeholder="Name"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
            />
            <input
              aria-label="Smart Space query"
              placeholder="#tag, type:image, by:pete, site:example.com"
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

        <p className="status">{status || 'Smart Spaces are shared saved searches inside the selected Mind.'}</p>

        {spaces.length ? (
          <div className="spaces-grid">
            {spaces.map((space) => (
              <article key={space.id} className="space-card">
                <button className="space-card__main" onClick={() => openSpace(space)}>
                  <span className="space-card__dot" style={{ borderColor: space.color }} />
                  <span className="space-card__name">{space.name}</span>
                  <span className="space-card__query">{space.query}</span>
                  <span className="space-card__query">Created by {space.createdByLabel ?? 'teammate'}</span>
                </button>
                <button className="space-card__delete" onClick={() => deleteSpace(space.id)}>
                  Delete
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="mind-empty">
            <h2>No Smart Spaces yet.</h2>
            <p>Save filtered views like #creative-direction, type:video, by:pete, or site:peterarango.com.</p>
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
