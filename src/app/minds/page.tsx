'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { NewMindModal } from '@/components/new-mind-modal';
import { authedFetch } from '@/lib/client-auth';

type Mind = {
  role: string;
  workspaces: {
    id: string;
    name: string;
    member_count?: number;
    system_prompt: string | null;
    voice_source: string;
    voice_user_ids: string[];
    provider: string;
    model: string | null;
    created_at: string;
  };
};

function getMindLabel(mind: Mind | undefined) {
  if (!mind) return 'Mind';
  return (mind.workspaces.member_count ?? 1) > 1 ? 'Shared Mind' : 'Mind';
}

function MindsContent() {
  const router = useRouter();
  const [minds, setMinds] = useState<Mind[]>([]);
  const [status, setStatus] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const loadMinds = useCallback(async () => {
    const response = await authedFetch('/api/workspaces');
    const data = await response.json();
    setMinds((data.workspaces ?? []) as Mind[]);
  }, []);

  useEffect(() => {
    loadMinds();
  }, [loadMinds]);

  const openMind = (mind: Mind) => {
    window.localStorage.setItem('muttmind:active-mind-id', mind.workspaces.id);
    router.push('/dashboard');
  };

  const beginEdit = (mind: Mind) => {
    setEditingId(mind.workspaces.id);
    setEditingPrompt(mind.workspaces.system_prompt ?? '');
    setStatus('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingPrompt('');
  };

  const savePrompt = async () => {
    if (!editingId) return;
    setIsSavingPrompt(true);
    setStatus('Saving…');
    const response = await authedFetch('/api/workspaces', {
      method: 'PATCH',
      body: JSON.stringify({
        workspaceId: editingId,
        systemPrompt: editingPrompt,
      }),
    });
    const data = await response.json();
    setIsSavingPrompt(false);
    if (!response.ok) {
      setStatus(data.error ?? 'Unable to save prompt.');
      return;
    }
    setStatus('Mind updated.');
    setEditingId(null);
    setEditingPrompt('');
    await loadMinds();
  };

  return (
    <main className="app-shell mind-shell">
      <AppNav active="minds" />

      <section className="spaces-page" aria-labelledby="minds-title">
        <div className="spaces-page__header">
          <div>
            <p className="eyebrow">All Minds</p>
            <h1 id="minds-title">Minds</h1>
            <p className="lede">
              A Mind is a focused container for one research project, topic, or interest. Solo by default; share to make it a Shared Mind.
            </p>
          </div>
          <div className="spaces-page__actions">
            <button type="button" className="button" onClick={() => setModalOpen(true)}>
              + New Mind
            </button>
          </div>
        </div>

        {status ? <p className="status">{status}</p> : null}

        {minds.length ? (
          <div className="spaces-grid">
            {minds.map((mind) => (
              <article key={mind.workspaces.id} className="space-card">
                <button className="space-card__main" onClick={() => openMind(mind)}>
                  <span className="space-card__name">{mind.workspaces.name}</span>
                  <span className="space-card__query">{getMindLabel(mind)} · {mind.workspaces.member_count ?? 1} {mind.workspaces.member_count === 1 ? 'member' : 'members'}</span>
                  <span className="space-card__query">Role: {mind.role}</span>
                </button>
                <div className="space-card__row">
                  <button type="button" className="link-button" onClick={() => beginEdit(mind)}>
                    {editingId === mind.workspaces.id ? 'Editing prompt' : 'Edit prompt'}
                  </button>
                </div>
                {editingId === mind.workspaces.id ? (
                  <div className="space-card__editor">
                    <label className="onboarding__field">
                      <span className="onboarding__label">System prompt</span>
                      <textarea
                        className="onboarding__textarea onboarding__textarea--prompt"
                        value={editingPrompt}
                        onChange={(event) => setEditingPrompt(event.target.value)}
                        rows={12}
                      />
                    </label>
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
                        {isSavingPrompt ? 'Saving…' : 'Save Mind'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="mind-empty">
            <h2>No Minds yet.</h2>
            <p>Create one to start collecting links and notes around a project or topic.</p>
            <button
              type="button"
              className="button"
              style={{ marginTop: 16 }}
              onClick={() => setModalOpen(true)}
            >
              + New Mind
            </button>
          </div>
        )}
      </section>

      <NewMindModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => loadMinds()}
      />
    </main>
  );
}

export default function MindsPage() {
  return (
    <AuthGate>
      <MindsContent />
    </AuthGate>
  );
}
