'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { Dropdown } from '@/components/dropdown';
import { authedFetch, getAccessToken } from '@/lib/client-auth';

type Mind = {
  id: string;
  name: string;
  description: string | null;
  privacy: string;
  system_prompt: string | null;
  member_count?: number;
};

type Tag = { id: string; shift_name: string; description: string | null };
type Member = { role: string; user: { id: string; email: string | null; displayName: string | null } };
type Invite = { id: string; email: string | null; token: string; role: string; accepted_at: string | null };

type Privacy = 'open' | 'closed' | 'private';

const PRIVACY_OPTIONS = [
  { value: 'open' as Privacy, name: 'Open', hint: 'Anyone can view and add.', tone: 'open' },
  { value: 'closed' as Privacy, name: 'Closed', hint: 'Anyone can view; only collaborators add.', tone: 'closed' },
  { value: 'private' as Privacy, name: 'Private', hint: 'Only collaborators can view or add.', tone: 'private' },
];

function SettingsContent() {
  const params = useParams<{ id: string }>();
  const mindId = params.id;

  const [mind, setMind] = useState<Mind | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('closed');
  const [tags, setTags] = useState<Tag[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [status, setStatus] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [tagName, setTagName] = useState('');
  const [tagDescription, setTagDescription] = useState('');

  const loadMind = useCallback(async () => {
    const r = await authedFetch('/api/workspaces');
    const d = await r.json();
    const found = (d.workspaces ?? []).find(
      (row: { workspaces?: { id: string } }) => row.workspaces?.id === mindId,
    );
    if (found?.workspaces) {
      const w = found.workspaces;
      setMind({
        id: w.id,
        name: w.name,
        description: w.description ?? null,
        privacy: w.privacy ?? 'closed',
        system_prompt: w.system_prompt ?? null,
        member_count: w.member_count,
      });
      setName(w.name ?? '');
      setDescription(w.description ?? '');
      setPrivacy((w.privacy as Privacy) ?? 'closed');
    }
  }, [mindId]);

  const loadTags = useCallback(async () => {
    const r = await authedFetch(`/api/tags?workspaceId=${mindId}`);
    const d = await r.json();
    setTags((d.tags ?? []) as Tag[]);
  }, [mindId]);

  const loadMembers = useCallback(async () => {
    const [mr, ir] = await Promise.all([
      authedFetch(`/api/members?workspaceId=${mindId}`),
      authedFetch(`/api/invites?workspaceId=${mindId}`),
    ]);
    const md = await mr.json();
    const id = await ir.json();
    setMembers(mr.ok ? md.members ?? [] : []);
    setInvites(ir.ok ? id.invites ?? [] : []);
  }, [mindId]);

  useEffect(() => {
    loadMind();
    loadTags();
    loadMembers();
  }, [loadMind, loadTags, loadMembers]);

  const saveIdentity = async () => {
    setStatus('Saving…');
    const r = await authedFetch('/api/workspaces', {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId: mindId, title: name.trim(), description }),
    });
    const d = await r.json();
    setStatus(r.ok ? 'Saved.' : d.error ?? 'Could not save.');
    if (r.ok) loadMind();
  };

  const savePrivacy = async (next: Privacy) => {
    setPrivacy(next);
    const r = await authedFetch('/api/workspaces', {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId: mindId, privacy: next }),
    });
    if (!r.ok) {
      const d = await r.json();
      setStatus(d.error ?? 'Could not change privacy.');
    } else {
      setStatus('Privacy updated.');
    }
  };

  const inviteByEmail = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setStatus('Creating invite…');
    const r = await authedFetch('/api/members', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: mindId, email }),
    });
    const d = await r.json();
    if (!r.ok) {
      setStatus(d.error ?? 'Could not invite.');
      return;
    }
    if (d.invite?.token) setShareLink(`${window.location.origin}/invite/${d.invite.token}`);
    setStatus('Invite created.');
    setInviteEmail('');
    loadMembers();
  };

  const createShareLink = async () => {
    setStatus('Creating share link…');
    const r = await authedFetch('/api/invites', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: mindId }),
    });
    const d = await r.json();
    if (!r.ok) {
      setStatus(d.error ?? 'Could not create link.');
      return;
    }
    setShareLink(`${window.location.origin}/invite/${d.invite.token}`);
    setStatus('Share link created.');
    loadMembers();
  };

  const createTag = async () => {
    if (!tagName.trim()) return;
    const r = await authedFetch('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: mindId, shiftName: tagName.trim(), description: tagDescription.trim() }),
    });
    if (r.ok) {
      setTagName('');
      setTagDescription('');
      loadTags();
    } else {
      const d = await r.json();
      setStatus(d.error ?? 'Could not add tag.');
    }
  };

  const deleteTag = async (tagId: string) => {
    if (!confirm('Delete this tag?')) return;
    const r = await authedFetch(`/api/tags?workspaceId=${mindId}&tagId=${tagId}`, { method: 'DELETE' });
    if (r.ok) loadTags();
  };

  const exportArchive = async () => {
    setStatus('Building export…');
    const token = await getAccessToken();
    const r = await fetch(`/api/export?workspaceId=${mindId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      setStatus('Could not export.');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `muttmind-${mindId}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Export downloaded.');
  };

  if (!mind) {
    return (
      <main className="app-shell ms-shell">
        <AppNav active="minds" />
        <section className="ms-page">
          <p className="ms-loading">Loading…</p>
        </section>
      </main>
    );
  }

  const pendingInvites = invites.filter((i) => !i.accepted_at);

  return (
    <main className="app-shell ms-shell">
      <AppNav active="minds" />

      <section className="ms-page">
        <header className="ms-top">
          <div className="ms-crumb">
            <Link href="/minds" className="ms-crumb__link">minds</Link>
            <span className="ms-crumb__sep">/</span>
            <span>{mind.name}</span>
            <span className="ms-crumb__sep">/</span>
            <span className="ms-crumb__current">settings</span>
          </div>
          <Link href="/dashboard" className="ms-open" onClick={() => window.localStorage.setItem('muttmind:active-mind-id', mind.id)}>
            Open Mind →
          </Link>
        </header>

        {status ? <p className="ms-status">{status}</p> : null}

        <section className="ms-section">
          <h2 className="ms-section__title">Identity</h2>
          <label className="ms-field">
            <span className="ms-field__label">Name</span>
            <input className="ms-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="ms-field">
            <span className="ms-field__label">Description</span>
            <textarea
              className="ms-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="A one-liner about what this Mind is for"
            />
          </label>
          <button type="button" className="ms-btn" onClick={saveIdentity}>
            Save identity
          </button>
        </section>

        <section className="ms-section">
          <h2 className="ms-section__title">Assistant</h2>
          <p className="ms-section__hint">
            The system prompt defines how this Mind&apos;s assistant behaves. Tailor it through the guided flow,
            or hand-edit it there.
          </p>
          <div className="ms-invite__actions">
            <Link href={`/minds/${mind.id}/tailor`} className="ms-btn">
              Tailor the assistant →
            </Link>
            <Link href={`/minds/${mind.id}/essays`} className="ms-btn ms-btn--ghost">
              Synthesis essays →
            </Link>
          </div>
          <div className="ms-field" style={{ marginTop: 18 }}>
            <span className="ms-field__label">Privacy</span>
            <Dropdown
              value={privacy}
              options={PRIVACY_OPTIONS}
              onChange={(v) => savePrivacy(v)}
              ariaLabel="Privacy"
              size="modal"
            />
            <span className="ms-field__optional">
              {PRIVACY_OPTIONS.find((o) => o.value === privacy)?.hint}
            </span>
          </div>
        </section>

        <section className="ms-section">
          <h2 className="ms-section__title">
            Members <span className="ms-section__count">{members.length}</span>
          </h2>
          <div className="ms-members">
            {members.map((m) => (
              <div key={m.user.id} className="ms-member">
                <span className="ms-member__name">{m.user.displayName || m.user.email || 'Member'}</span>
                <span className="ms-member__role">{m.role}</span>
              </div>
            ))}
            {pendingInvites.map((i) => (
              <div key={i.id} className="ms-member ms-member--pending">
                <span className="ms-member__name">{i.email || 'Share link'}</span>
                <span className="ms-member__role">pending</span>
              </div>
            ))}
          </div>
          <div className="ms-invite">
            <input
              className="ms-input"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="friend@example.com"
            />
            <div className="ms-invite__actions">
              <button type="button" className="ms-btn ms-btn--ghost" onClick={inviteByEmail}>
                Invite by email
              </button>
              <button type="button" className="ms-btn ms-btn--ghost" onClick={createShareLink}>
                Create share link
              </button>
            </div>
          </div>
          {shareLink ? (
            <div className="ms-share">
              <code className="ms-share__url">{shareLink}</code>
              <button
                type="button"
                className="ms-btn ms-btn--ghost"
                onClick={() => navigator.clipboard?.writeText(shareLink)}
              >
                Copy
              </button>
            </div>
          ) : null}
        </section>

        <section className="ms-section">
          <h2 className="ms-section__title">
            Tags <span className="ms-section__count">{tags.length}</span>
          </h2>
          <div className="ms-tag-add">
            <input
              className="ms-input"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="tag-name"
            />
            <input
              className="ms-input"
              value={tagDescription}
              onChange={(e) => setTagDescription(e.target.value)}
              placeholder="Optional description"
            />
            <button type="button" className="ms-btn ms-btn--ghost" onClick={createTag}>
              Add
            </button>
          </div>
          <div className="tag-table" role="list" aria-label="Tags">
            <div className="tag-table__head" aria-hidden="true">
              <span>Tag</span>
              <span>Description</span>
              <span />
            </div>
            {tags.length === 0 ? <p className="tag-table__empty">No tags yet.</p> : null}
            {tags.map((tag) => (
              <div key={tag.id} className="tag-row" role="listitem">
                <span className="tag-row__name">{tag.shift_name}</span>
                <span className={`tag-row__desc${tag.description ? '' : ' tag-row__desc--empty'}`}>
                  {tag.description || 'No description'}
                </span>
                <div className="tag-row__actions">
                  <button
                    type="button"
                    className="link-button link-button--danger"
                    onClick={() => deleteTag(tag.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="ms-section">
          <h2 className="ms-section__title">Export & capture</h2>
          <div className="ms-invite__actions">
            <button type="button" className="ms-btn ms-btn--ghost" onClick={exportArchive}>
              Download Obsidian archive
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}

export default function MindSettingsPage() {
  return (
    <AuthGate>
      <SettingsContent />
    </AuthGate>
  );
}
