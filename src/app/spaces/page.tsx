'use client';

import Link from 'next/link';
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
  createdBy: string;
  createdByLabel?: string;
  systemPrompt: string | null;
  voiceSource: string;
  voiceUserIds: string[];
  modeType: string;
  provider: string;
  model: string | null;
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
  const [status, setStatus] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  const currentMind = minds.find((mind) => mind.workspaces.id === mindId);

  const loadMinds = useCallback(async () => {
    const response = await authedFetch('/api/workspaces');
    const data = await response.json();
    const nextMinds = data.workspaces ?? [];
    setMinds(nextMinds);
    setMindId((current) => current || nextMinds[0]?.workspaces?.id || '');
  }, []);

  const loadSpaces = useCallback(
    async (nextMindId = mindId) => {
      if (!nextMindId) {
        setSpaces([]);
        return;
      }
      const response = await authedFetch(`/api/spaces?workspaceId=${nextMindId}`);
      const data = await response.json();
      setSpaces(data.spaces ?? []);
    },
    [mindId],
  );

  useEffect(() => {
    loadMinds();
  }, [loadMinds]);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  const openSpace = (space: SmartSpace) => {
    window.localStorage.setItem('muttmind:active-space-query', space.query);
    window.localStorage.setItem('muttmind:active-mind-id', space.workspaceId);
    router.push('/dashboard');
  };

  const deleteSpace = async (spaceId: string) => {
    if (!mindId) return;
    if (!confirm('Delete this Space? Captures stay in the Mind.')) return;
    const response = await authedFetch(`/api/spaces?workspaceId=${mindId}&spaceId=${spaceId}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error ?? 'Unable to delete Space.');
      return;
    }
    await loadSpaces();
  };

  const beginEdit = (space: SmartSpace) => {
    setEditingId(space.id);
    setEditingPrompt(space.systemPrompt ?? '');
    setStatus('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingPrompt('');
  };

  const savePrompt = async () => {
    if (!editingId || !mindId) return;
    setIsSavingPrompt(true);
    setStatus('Saving prompt…');
    const response = await authedFetch('/api/spaces', {
      method: 'PATCH',
      body: JSON.stringify({
        workspaceId: mindId,
        spaceId: editingId,
        systemPrompt: editingPrompt,
      }),
    });
    const data = await response.json();
    setIsSavingPrompt(false);
    if (!response.ok) {
      setStatus(data.error ?? 'Unable to save prompt.');
      return;
    }
    setStatus('Prompt saved.');
    setEditingId(null);
    setEditingPrompt('');
    await loadSpaces();
  };

  return (
    <main className="app-shell mind-shell">
      <AppNav active="spaces" />

      <section className="spaces-page" aria-labelledby="spaces-title">
        <div className="spaces-page__header">
          <div>
            <p className="eyebrow">{getMindLabel(currentMind)} / Spaces</p>
            <h1 id="spaces-title">Spaces</h1>
            <p className="lede">
              A Space is a focused research project inside this Mind. It has its own filter, system prompt, and voice.
            </p>
          </div>
          <div className="spaces-page__actions">
            <select value={mindId} onChange={(event) => setMindId(event.target.value)} aria-label="Choose Mind">
              <option value="">Choose Mind</option>
              {minds.map((mind) => (
                <option key={mind.workspaces.id} value={mind.workspaces.id}>
                  {mind.workspaces.name} - {getMindLabel(mind)}
                </option>
              ))}
            </select>
            <Link href="/spaces/new" className="button">
              + New Space
            </Link>
          </div>
        </div>

        {status ? <p className="status">{status}</p> : null}

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
                <div className="space-card__row">
                  <button type="button" className="link-button" onClick={() => beginEdit(space)}>
                    {editingId === space.id ? 'Editing prompt' : 'Edit prompt'}
                  </button>
                  <button
                    type="button"
                    className="link-button link-button--danger"
                    onClick={() => deleteSpace(space.id)}
                  >
                    Delete
                  </button>
                </div>
                {editingId === space.id ? (
                  <div className="space-card__editor">
                    <textarea
                      className="onboarding__textarea onboarding__textarea--prompt"
                      value={editingPrompt}
                      onChange={(event) => setEditingPrompt(event.target.value)}
                      rows={12}
                    />
                    <div className="space-card__editor-row">
                      <button type="button" className="link-button" onClick={cancelEdit}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={savePrompt}
                        disabled={isSavingPrompt || !editingPrompt.trim()}
                      >
                        {isSavingPrompt ? 'Saving…' : 'Save prompt'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="mind-empty">
            <h2>No Spaces yet.</h2>
            <p>Create one to focus the assistant on a research thread or topic.</p>
            <Link href="/spaces/new" className="button" style={{ marginTop: 16 }}>
              + New Space
            </Link>
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
