'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch, getAccessToken } from '@/lib/client-auth';

type Workspace = {
  role: string;
  workspaces: {
    id: string;
    name: string;
    title?: string;
    created_at: string;
  };
};

type Tag = {
  id: string;
  shift_name: string;
  description: string | null;
  created_at: string;
};

function SettingsContent() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [status, setStatus] = useState('Loading settings...');
  const [tagName, setTagName] = useState('');
  const [tagDescription, setTagDescription] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingDescription, setEditingDescription] = useState('');

  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.workspaces.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  const loadWorkspaces = async () => {
    const r = await authedFetch('/api/workspaces');
    const d = await r.json();
    const nextWorkspaces = d.workspaces ?? [];
    setWorkspaces(nextWorkspaces);
    setWorkspaceId((current) => current || nextWorkspaces[0]?.workspaces.id || '');
    if (!nextWorkspaces.length) setStatus('Create a workspace before managing tags.');
  };

  const loadTags = async (nextWorkspaceId = workspaceId) => {
    if (!nextWorkspaceId) {
      setTags([]);
      return;
    }

    const r = await authedFetch(`/api/tags?workspaceId=${nextWorkspaceId}`);
    const d = await r.json();
    setTags((d.tags ?? []) as Tag[]);
  };

  useEffect(() => {
    (async () => {
      await loadWorkspaces();
    })();
  }, []);

  useEffect(() => {
    loadTags();
  }, [workspaceId]);

  const createTag = async () => {
    if (!workspaceId) return;
    const shiftName = tagName.trim();
    if (!shiftName) {
      setStatus('Enter a tag name first.');
      return;
    }
    setStatus('Saving tag...');
    const r = await authedFetch('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, shiftName, description: tagDescription.trim() }),
    });
    const d = await r.json();
    if (!r.ok) {
      setStatus(d.error ?? 'Unable to save tag.');
      return;
    }
    setTagName('');
    setTagDescription('');
    await loadTags();
    setStatus('Tag saved.');
  };

  const beginEditTag = (tag: Tag) => {
    setEditingTagId(tag.id);
    setEditingName(tag.shift_name);
    setEditingDescription(tag.description ?? '');
  };

  const saveTag = async () => {
    if (!workspaceId || !editingTagId) return;
    setStatus('Updating tag...');
    const r = await authedFetch('/api/tags', {
      method: 'PATCH',
      body: JSON.stringify({
        workspaceId,
        tagId: editingTagId,
        shiftName: editingName.trim(),
        description: editingDescription.trim(),
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      setStatus(d.error ?? 'Unable to update tag.');
      return;
    }
    setEditingTagId(null);
    setEditingName('');
    setEditingDescription('');
    await loadTags();
    setStatus('Tag updated.');
  };

  const deleteTag = async (tagId: string) => {
    if (!workspaceId) return;
    if (!confirm('Delete this tag?')) return;
    setStatus('Deleting tag...');
    const r = await authedFetch(`/api/tags?workspaceId=${workspaceId}&tagId=${tagId}`, { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok) {
      setStatus(d.error ?? 'Unable to delete tag.');
      return;
    }
    await loadTags();
    setStatus('Tag deleted.');
  };

  const exportVault = async () => {
    if (!workspaceId) return;
    setStatus('Building export...');
    const token = await getAccessToken();
    const r = await fetch(`/api/export?workspaceId=${workspaceId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const d = await r.json();
      setStatus(d.error ?? 'Unable to export vault.');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `muttmind-${workspaceId}.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('Export downloaded.');
  };

  return (
    <main className="app-shell">
      <AppNav active="settings" />

      <section className="section-header section-header--compact" aria-labelledby="settings-title">
        <div>
          <p className="eyebrow">§ Settings / Workspace controls</p>
          <h1 id="settings-title">Tags and export.</h1>
          <p className="lede">
            Manage the framework tags MuttMind uses for captures, and download a portable workspace archive.
          </p>
        </div>
        <Link href="/dashboard" className="button-secondary">
          Back to Dashboard
        </Link>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>Settings scope</h2>
          </div>
          <div className="button-row">
            <button className="button-secondary" onClick={exportVault}>
              Download Obsidian Vault
            </button>
            <span className="tag-pill">{currentWorkspace?.workspaces.name ?? 'No workspace selected'}</span>
          </div>
        </div>

        <div className="vault-layout">
          <aside className="vault-sidebar">
            <label className="form-row">
              <span className="field-label">Workspace</span>
              <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                <option value="">Select workspace</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.workspaces.id} value={workspace.workspaces.id}>
                    {workspace.workspaces.name} ({workspace.role})
                  </option>
                ))}
              </select>
            </label>

            <article className="vault-group">
              <div className="vault-group__header">
                <p className="kicker">Access</p>
              </div>
              <p className="vault-group__title">Workspace members</p>
              <p className="meta vault-group__meta">Signed-in members can capture links and manage workspace material.</p>
            </article>

            <article className="vault-group">
              <div className="vault-group__header">
                <p className="kicker">Telegram</p>
              </div>
              <p className="vault-group__title">Bot capture</p>
              <p className="meta vault-group__meta">Saved links from Telegram appear in the selected workspace.</p>
            </article>

            <article className="vault-group">
              <div className="vault-group__header">
                <p className="kicker">Export</p>
              </div>
              <p className="vault-group__title">Portable archive</p>
              <p className="meta vault-group__meta">Download the workspace as markdown files with tags and source links.</p>
            </article>
          </aside>

          <div className="vault-main">
            <div className="form-grid">
              <label className="form-row">
                <span className="field-label">New tag</span>
                <input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="cultural-shift" />
              </label>
              <label className="form-row">
                <span className="field-label">Description</span>
                <input
                  value={tagDescription}
                  onChange={(e) => setTagDescription(e.target.value)}
                  placeholder="Short framework description"
                />
              </label>
            </div>
            <div className="button-row">
              <button className="button" onClick={createTag}>
                Add Tag
              </button>
            </div>
            <p className="status">{status}</p>

            <div className="settings-list">
              {tags.map((tag) => (
                <article key={tag.id} className="vault-group">
                  {editingTagId === tag.id ? (
                    <>
                      <label className="form-row">
                        <span className="field-label">Tag name</span>
                        <input value={editingName} onChange={(e) => setEditingName(e.target.value)} />
                      </label>
                      <label className="form-row">
                        <span className="field-label">Description</span>
                        <input
                          value={editingDescription}
                          onChange={(e) => setEditingDescription(e.target.value)}
                        />
                      </label>
                      <div className="button-row">
                        <button className="button" onClick={saveTag}>
                          Save
                        </button>
                        <button className="button-ghost" onClick={() => setEditingTagId(null)}>
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="vault-group__header">
                        <p className="kicker">Tag</p>
                        <span className="tag-pill">{tag.shift_name}</span>
                      </div>
                      <p className="vault-group__title">{tag.description || 'No description yet.'}</p>
                      <div className="button-row">
                        <button className="button-secondary" onClick={() => beginEditTag(tag)}>
                          Edit
                        </button>
                        <button className="button-secondary" onClick={() => deleteTag(tag.id)}>
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsContent />
    </AuthGate>
  );
}
