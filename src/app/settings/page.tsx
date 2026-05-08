'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
    member_count?: number;
  };
};

type Tag = {
  id: string;
  shift_name: string;
  description: string | null;
  created_at: string;
};

type Member = {
  role: string;
  createdAt: string;
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
  };
};

type Invite = {
  id: string;
  email: string | null;
  token: string;
  role: string;
  accepted_at: string | null;
  expires_at: string | null;
};

function getMindLabel(workspace: Workspace | null) {
  if (!workspace) return 'Mind';
  return (workspace.workspaces.member_count ?? 1) > 1 ? 'Shared Mind' : 'Mind';
}

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
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [latestInviteLink, setLatestInviteLink] = useState('');
  const telegramBotUrl = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL ?? '';

  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.workspaces.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  const loadWorkspaces = useCallback(async () => {
    const r = await authedFetch('/api/workspaces');
    const d = await r.json();
    const nextWorkspaces = d.workspaces ?? [];
    setWorkspaces(nextWorkspaces);
    setWorkspaceId((current) => current || nextWorkspaces[0]?.workspaces.id || '');
    if (!nextWorkspaces.length) setStatus('Create a Mind before managing tags.');
  }, []);

  const loadTags = useCallback(async (nextWorkspaceId = workspaceId) => {
    if (!nextWorkspaceId) {
      setTags([]);
      return;
    }

    const r = await authedFetch(`/api/tags?workspaceId=${nextWorkspaceId}`);
    const d = await r.json();
    setTags((d.tags ?? []) as Tag[]);
  }, [workspaceId]);

  const loadMembers = useCallback(async (nextWorkspaceId = workspaceId) => {
    if (!nextWorkspaceId) {
      setMembers([]);
      setInvites([]);
      return;
    }

    const [membersResponse, invitesResponse] = await Promise.all([
      authedFetch(`/api/members?workspaceId=${nextWorkspaceId}`),
      authedFetch(`/api/invites?workspaceId=${nextWorkspaceId}`),
    ]);
    const membersData = await membersResponse.json();
    const invitesData = await invitesResponse.json();
    setMembers(membersResponse.ok ? membersData.members ?? [] : []);
    setInvites(invitesResponse.ok ? invitesData.invites ?? [] : []);
  }, [workspaceId]);

  useEffect(() => {
    (async () => {
      await loadWorkspaces();
    })();
  }, [loadWorkspaces]);

  useEffect(() => {
    loadTags();
    loadMembers();
  }, [loadMembers, loadTags]);

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
      setStatus(d.error ?? 'Unable to export archive.');
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

  const buildInviteLink = (token: string) => `${window.location.origin}/invite/${token}`;

  const inviteByEmail = async () => {
    if (!workspaceId) return;
    const email = inviteEmail.trim();
    if (!email) {
      setStatus('Enter an email address first.');
      return;
    }
    setStatus('Creating invite...');
    const response = await authedFetch('/api/members', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, email }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error ?? 'Unable to invite member.');
      return;
    }
    if (data.invite?.token) {
      setLatestInviteLink(buildInviteLink(data.invite.token));
      setStatus('Invite link created for that email.');
    } else {
      setLatestInviteLink('');
      setStatus('Member added to this Shared Mind.');
    }
    setInviteEmail('');
    await loadMembers();
    await loadWorkspaces();
  };

  const createInviteLink = async () => {
    if (!workspaceId) return;
    setStatus('Creating share link...');
    const response = await authedFetch('/api/invites', {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error ?? 'Unable to create invite link.');
      return;
    }
    const link = buildInviteLink(data.invite.token);
    setLatestInviteLink(link);
    setStatus('Share link created.');
    await loadMembers();
  };

  const openTelegramBot = useCallback(async () => {
    const popup = window.open('', '_blank');
    if (popup) popup.opener = null;

    setStatus('Opening Telegram bot...');
    const response = await authedFetch('/api/telegram-link', { method: 'POST' });
    const data = await response.json();
    const targetUrl = response.ok && data.url ? data.url : telegramBotUrl;

    if (!targetUrl) {
      popup?.close();
      setStatus(data.error ?? 'Telegram bot URL is not configured.');
      return;
    }

    if (popup) {
      popup.location.href = targetUrl;
    } else {
      window.location.href = targetUrl;
    }

    setStatus(
      response.ok
        ? 'Telegram opened. Press Start in the bot to link this account.'
        : `Telegram opened, but account linking needs attention: ${data.error ?? 'missing link token'}`,
    );
  }, [telegramBotUrl]);

  return (
    <main className="app-shell">
      <AppNav active="settings" />

      <section className="section-header section-header--compact" aria-labelledby="settings-title">
        <div>
          <p className="eyebrow">§ Settings / Mind controls</p>
          <h1 id="settings-title">Mind settings.</h1>
          <p className="lede">
            Manage collaborators, framework tags, and portable exports for the selected Mind.
          </p>
        </div>
        <Link href="/dashboard" className="button-secondary">
          Back to Dashboard
        </Link>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{getMindLabel(currentWorkspace)}</p>
            <h2>Settings scope</h2>
          </div>
          <div className="button-row">
            <button className="button-secondary" type="button" onClick={openTelegramBot}>
              Open Telegram Bot
            </button>
            <button className="button-secondary" onClick={exportVault}>
              Download Obsidian Archive
            </button>
            <span className="tag-pill">{currentWorkspace?.workspaces.name ?? 'No Mind selected'}</span>
          </div>
        </div>

        <div className="vault-layout">
          <aside className="vault-sidebar">
            <label className="form-row">
              <span className="field-label">Mind</span>
              <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                <option value="">Select Mind</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.workspaces.id} value={workspace.workspaces.id}>
                    {workspace.workspaces.name} - {workspace.workspaces.member_count && workspace.workspaces.member_count > 1 ? 'Shared Mind' : 'Mind'} ({workspace.role})
                  </option>
                ))}
              </select>
            </label>

            <article className="vault-group">
              <div className="vault-group__header">
                <p className="kicker">Access</p>
              </div>
              <p className="vault-group__title">{getMindLabel(currentWorkspace)} members</p>
              <p className="meta vault-group__meta">Invite people by email or share link. Once a Mind has multiple members, it becomes a Shared Mind.</p>
            </article>

            <article className="vault-group">
              <div className="vault-group__header">
                <p className="kicker">Telegram</p>
              </div>
              <p className="vault-group__title">Bot capture</p>
              <p className="meta vault-group__meta">Saved links from Telegram appear in the selected Mind.</p>
              <button className="button-secondary" type="button" onClick={openTelegramBot}>
                Open Telegram Bot
              </button>
            </article>

            <article className="vault-group">
              <div className="vault-group__header">
                <p className="kicker">Export</p>
              </div>
              <p className="vault-group__title">Portable archive</p>
              <p className="meta vault-group__meta">Download this Mind as markdown files with tags and source links.</p>
            </article>
          </aside>

          <div className="vault-main">
            <section className="settings-list" aria-label="Mind members">
              <article className="vault-group">
                <div className="vault-group__header">
                  <p className="kicker">Invite</p>
                  <span className="tag-pill">{members.length} member{members.length === 1 ? '' : 's'}</span>
                </div>
                <div className="form-grid">
                  <label className="form-row">
                    <span className="field-label">Email invite</span>
                    <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="friend@example.com" />
                  </label>
                  <div className="button-row">
                    <button className="button-secondary" onClick={inviteByEmail}>
                      Invite by Email
                    </button>
                    <button className="button-secondary" onClick={createInviteLink}>
                      Create Share Link
                    </button>
                  </div>
                  {latestInviteLink ? <p className="url">{latestInviteLink}</p> : null}
                </div>
              </article>

              {members.map((member) => (
                <article key={member.user.id} className="vault-group">
                  <div className="vault-group__header">
                    <p className="kicker">{member.role}</p>
                    <span className="tag-pill">{member.user.displayName || member.user.email || 'Member'}</span>
                  </div>
                  <p className="meta vault-group__meta">{member.user.email}</p>
                </article>
              ))}

              {invites.filter((invite) => !invite.accepted_at).map((invite) => (
                <article key={invite.id} className="vault-group">
                  <div className="vault-group__header">
                    <p className="kicker">Pending invite</p>
                    <span className="tag-pill">{invite.role}</span>
                  </div>
                  <p className="meta vault-group__meta">{invite.email || 'Share link'}</p>
                  <p className="url">{buildInviteLink(invite.token)}</p>
                </article>
              ))}
            </section>

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
