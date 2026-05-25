'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Dropdown } from '@/components/dropdown';
import { authedFetch, getAccessToken, getSupabaseBrowser } from '@/lib/client-auth';

type Mind = {
  id: string;
  name: string;
  description: string | null;
  privacy: string;
  system_prompt: string | null;
  member_count?: number;
  event_mode?: boolean;
  event_at?: string | null;
  event_end_at?: string | null;
  share_code?: string | null;
  allow_anonymous_contributions?: boolean;
  learning_enabled?: boolean;
  digest_prompt?: string | null;
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

const THINKING_PHASES = [
  'Reading your answers',
  'Drawing on the MuttMind ethos',
  'Anchoring to your stance',
  'Shaping the voice',
  'Polishing',
];

const SPINNER_FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

export default function SettingsPage() {
  const params = useParams<{ id: string }>();
  const mindId = params.id;

  const [mind, setMind] = useState<Mind | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [digestPrompt, setDigestPrompt] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('closed');
  const [tags, setTags] = useState<Tag[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [status, setStatus] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [tagName, setTagName] = useState('');
  const [tagDescription, setTagDescription] = useState('');
  const [digestOptIn, setDigestOptIn] = useState(false);
  const [myUserId, setMyUserId] = useState('');
  const [myRole, setMyRole] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copiedMoment, setCopiedMoment] = useState(false);

  // Tailor state
  const [systemPrompt, setSystemPrompt] = useState('');
  const [purpose, setPurpose] = useState('');
  const [primer, setPrimer] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [tick, setTick] = useState(0);

  // Drive the spinner + phase messages while the LLM is generating.
  useEffect(() => {
    if (!isGenerating) {
      setTick(0);
      return;
    }
    const id = window.setInterval(() => setTick((t) => t + 1), 100);
    return () => window.clearInterval(id);
  }, [isGenerating]);

  const spinnerGlyph = SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
  const currentPhase = THINKING_PHASES[Math.floor(tick / 14) % THINKING_PHASES.length];

  const loadMind = useCallback(async () => {
    const r = await authedFetch('/api/workspaces');
    const d = await r.json();
    const found = (d.workspaces ?? []).find(
      (row: { workspaces?: { id: string } }) => row.workspaces?.id === mindId,
    );
    if (found) setMyRole(found.role ?? '');
    if (found?.workspaces) {
      const w = found.workspaces;
      setMind({
        id: w.id,
        name: w.name,
        description: w.description ?? null,
        privacy: w.privacy ?? 'closed',
        system_prompt: w.system_prompt ?? null,
        member_count: w.member_count,
        event_mode: w.event_mode ?? false,
        event_at: w.event_at ?? null,
        event_end_at: w.event_end_at ?? null,
        share_code: w.share_code ?? null,
        allow_anonymous_contributions: w.allow_anonymous_contributions ?? false,
        learning_enabled: w.learning_enabled ?? false,
        digest_prompt: w.digest_prompt ?? null,
      });
      setName(w.name ?? '');
      setDescription(w.description ?? '');
      setDigestPrompt(w.digest_prompt ?? '');
      setPrivacy((w.privacy as Privacy) ?? 'closed');
      setSystemPrompt(w.system_prompt ?? '');
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

  const loadDigest = useCallback(async () => {
    const r = await authedFetch(`/api/digest-prefs?workspaceId=${mindId}`);
    if (r.ok) {
      const d = await r.json();
      setDigestOptIn(Boolean(d.optIn));
    }
  }, [mindId]);

  useEffect(() => {
    loadMind();
    loadTags();
    loadMembers();
    loadDigest();
    getSupabaseBrowser()
      .auth.getUser()
      .then(({ data }) => setMyUserId(data.user?.id ?? ''));
  }, [loadMind, loadTags, loadMembers, loadDigest]);

  const removeMember = async (target: Member) => {
    const isSelf = target.user.id === myUserId;
    const label = target.user.displayName || target.user.email || 'this member';
    const confirmMsg = isSelf
      ? 'Leave this Mind? You will lose access to its captures.'
      : `Remove ${label} from this Mind?`;
    if (!confirm(confirmMsg)) return;
    const r = await authedFetch(
      `/api/members?workspaceId=${mindId}&userId=${encodeURIComponent(target.user.id)}`,
      { method: 'DELETE' },
    );
    const d = await r.json();
    if (!r.ok) {
      setStatus(d.error ?? 'Could not remove member.');
      return;
    }
    if (isSelf) {
      window.location.href = '/minds';
      return;
    }
    setStatus(`${label} removed.`);
    loadMembers();
  };

  const canManageMembers = ['owner', 'admin'].includes(myRole);

  const toggleDigest = async () => {
    const next = !digestOptIn;
    setDigestOptIn(next);
    const r = await authedFetch('/api/digest-prefs', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: mindId, optIn: next }),
    });
    if (!r.ok) {
      setDigestOptIn(!next);
      setStatus('Could not update digest preference.');
    } else {
      setStatus(next ? 'Weekly digest on for you.' : 'Weekly digest off.');
    }
  };

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

  const momentUrl =
    mind?.share_code && typeof window !== 'undefined'
      ? `${window.location.origin}/m/${mind.share_code}`
      : '';

  useEffect(() => {
    if (!momentUrl) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    import('qrcode')
      .then((m) =>
        m.default.toDataURL(momentUrl, { margin: 1, width: 220, color: { dark: '#050505', light: '#f7f7f2' } }),
      )
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [momentUrl]);

  const patchEvent = async (fields: Record<string, unknown>, okMsg: string) => {
    const r = await authedFetch('/api/workspaces', {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId: mindId, ...fields }),
    });
    const d = await r.json();
    setStatus(r.ok ? okMsg : d.error ?? 'Could not update.');
    if (r.ok) loadMind();
  };

  const copyMomentLink = async () => {
    if (!momentUrl) return;
    try {
      await navigator.clipboard.writeText(momentUrl);
      setCopiedMoment(true);
      window.setTimeout(() => setCopiedMoment(false), 2000);
    } catch {
      /* clipboard unavailable */
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

  const generatePrompt = useCallback(async () => {
    if (!mind?.name) return;
    setIsGenerating(true);
    setStatus('');
    const response = await authedFetch('/api/workspaces/generate-prompt', {
      method: 'POST',
      body: JSON.stringify({
        name: mind.name,
        purpose: purpose.trim() || undefined,
        primer: primer.trim() || undefined,
      }),
    });
    const data = await response.json();
    setIsGenerating(false);
    if (!response.ok) {
      setStatus(data.error ?? 'Unable to generate a prompt — you can write one yourself.');
      return;
    }
    setSystemPrompt(data.systemPrompt ?? '');
  }, [mind, purpose, primer]);

  if (!mind) {
    return (
      <section className="ms-page">
        <p className="ms-loading">Loading…</p>
      </section>
    );
  }

  const pendingInvites = invites.filter((i) => !i.accepted_at);

  return (
    <section className="ms-page">
      <header className="ms-top">
        <div className="ms-crumb">
          <Link href="/minds" className="ms-crumb__link">minds</Link>
          <span className="ms-crumb__sep">/</span>
          <span>{mind.name}</span>
          <span className="ms-crumb__sep">/</span>
          <span className="ms-crumb__current">settings</span>
        </div>
        <Link href={`/minds/${mindId}`} className="ms-open">
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
        <h2 className="ms-section__title">Tailor the assistant</h2>
        <p className="ms-section__hint">
          Describe what this Mind is for and optionally prime the assistant with context. Click
          &ldquo;Generate prompt&rdquo; to let MuttMind draft a system prompt, then edit it freely
          before saving. Or write the system prompt directly.
        </p>

        <label className="ms-field">
          <span className="ms-field__label">
            What is this Mind for?{' '}
            <span className="ms-field__optional">— optional</span>
          </span>
          <textarea
            className="ms-textarea"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Collecting references and arguments for our brand refresh. We're leaning toward something quieter and more typographic."
            rows={4}
          />
        </label>

        <label className="ms-field" style={{ marginTop: 16 }}>
          <span className="ms-field__label">
            Priming context{' '}
            <span className="ms-field__optional">— optional</span>
          </span>
          <textarea
            className="ms-textarea"
            value={primer}
            onChange={(e) => setPrimer(e.target.value)}
            placeholder="e.g. I have a strong bias toward Swiss design and away from playful illustration. Take Pentagram and Wim Crouwel seriously."
            rows={4}
          />
          <span className="ms-field__optional" style={{ marginTop: 4 }}>
            Things you want the assistant to know about your stance, sources, or what to ignore.
          </span>
        </label>

        <div className="ms-invite__actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="ms-btn ms-btn--ghost"
            onClick={generatePrompt}
            disabled={isGenerating}
          >
            {isGenerating ? 'Generating…' : systemPrompt ? 'Regenerate prompt' : 'Generate prompt'}
          </button>
        </div>

        {isGenerating ? (
          <div className="thinking" aria-live="polite" aria-busy="true" style={{ marginTop: 16 }}>
            <div className="thinking__head">
              <span className="thinking__spinner" aria-hidden="true">{spinnerGlyph}</span>
              <span className="thinking__label">Drafting</span>
            </div>
            <div className="thinking__phase" key={currentPhase}>
              {currentPhase}
              <span className="thinking__ellipsis" aria-hidden="true">…</span>
            </div>
            <div className="thinking__bar" aria-hidden="true" />
            <ul className="thinking__phases-list" aria-hidden="true">
              {THINKING_PHASES.map((phase) => (
                <li
                  key={phase}
                  className={`thinking__phases-item ${phase === currentPhase ? 'thinking__phases-item--active' : ''}`}
                >
                  {phase}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <label className="ms-field" style={{ marginTop: 20 }}>
          <span className="ms-field__label">System prompt</span>
          <textarea
            className="ms-textarea"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={12}
            placeholder="The system prompt defines how this Mind's assistant behaves. Generate one above or write it yourself."
          />
          <span className="ms-field__optional" style={{ marginTop: 4 }}>
            Edit freely — this is what the assistant sees before every conversation.
          </span>
        </label>

        <button
          type="button"
          className="ms-btn"
          style={{ justifySelf: 'start' }}
          disabled={isGenerating}
          onClick={() => patchEvent({ systemPrompt: systemPrompt.trim() || null }, 'Assistant prompt saved.')}
        >
          Save assistant prompt
        </button>

        <div className="ms-invite__actions" style={{ marginTop: 16 }}>
          <Link href={`/minds/${mind.id}/essays`} className="ms-btn ms-btn--ghost">
            Synthesis essays →
          </Link>
          <Link href={`/minds/${mind.id}/ask`} className="ms-btn ms-btn--ghost">
            Ask this Mind →
          </Link>
        </div>
      </section>

      <section className="ms-section">
        <h2 className="ms-section__title">Privacy</h2>
        <div className="ms-field">
          <span className="ms-field__label">Who can see and add to this Mind</span>
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
        <h2 className="ms-section__title">Weekly digest</h2>
        <p className="ms-section__hint">
          Get this Mind&apos;s weekly synthesis essay delivered to Telegram. Per-person — only you
          control your own delivery. Off by default.
        </p>
        <button
          type="button"
          className={`ms-toggle ${digestOptIn ? 'ms-toggle--on' : ''}`}
          onClick={toggleDigest}
          role="switch"
          aria-checked={digestOptIn}
        >
          <span className="ms-toggle__dot" />
          <span className="ms-toggle__label">
            {digestOptIn ? 'Weekly digest is ON for you' : 'Weekly digest is off'}
          </span>
        </button>

        <label className="ms-field" style={{ marginTop: 20 }}>
          <span className="ms-field__label">
            Digest prompt{' '}
            <span className="ms-field__optional">
              — optional, applies to this Mind for everyone
            </span>
          </span>
          <textarea
            className="ms-textarea"
            rows={3}
            value={digestPrompt}
            placeholder={'Leave blank for the default synthesis. e.g. “Lead with what changed this week and one thing worth chasing next.”'}
            onChange={(e) => setDigestPrompt(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="ms-btn"
          style={{ justifySelf: 'start' }}
          onClick={() =>
            patchEvent(
              { digestPrompt: digestPrompt.trim() || null },
              'Digest prompt saved.',
            )
          }
        >
          Save digest prompt
        </button>
      </section>

      <section className="ms-section">
        <h2 className="ms-section__title">Reflection &amp; learning</h2>
        <p className="ms-section__hint">
          When on, this Mind quietly distills a durable takeaway each time it
          synthesizes, and consolidates them weekly — so its assistant gets sharper
          for research over time. Off by default; no extra cost when off.
        </p>
        <button
          type="button"
          className={`ms-toggle ${mind.learning_enabled ? 'ms-toggle--on' : ''}`}
          onClick={() =>
            patchEvent(
              { learningEnabled: !mind.learning_enabled },
              mind.learning_enabled ? 'Reflection off.' : 'Reflection on.',
            )
          }
          role="switch"
          aria-checked={!!mind.learning_enabled}
        >
          <span className="ms-toggle__dot" />
          <span className="ms-toggle__label">
            {mind.learning_enabled
              ? 'This Mind reflects & learns'
              : 'Let this Mind reflect & learn'}
          </span>
        </button>
      </section>

      <section className="ms-section">
        <h2 className="ms-section__title">
          Members <span className="ms-section__count">{members.length}</span>
        </h2>
        <div className="ms-members">
          {members.map((m) => {
            const isSelf = m.user.id === myUserId;
            const isOwner = m.role === 'owner';
            const showRemove = !isOwner && canManageMembers && !isSelf;
            const showLeave = isSelf && !isOwner;
            return (
              <div key={m.user.id} className="ms-member">
                <span className="ms-member__name">
                  {m.user.displayName || m.user.email || 'Member'}
                  {isSelf ? <span className="ms-member__you"> you</span> : null}
                </span>
                <span className="ms-member__role">{m.role}</span>
                {showRemove ? (
                  <button
                    type="button"
                    className="ms-member__remove"
                    onClick={() => removeMember(m)}
                  >
                    Remove
                  </button>
                ) : showLeave ? (
                  <button
                    type="button"
                    className="ms-member__remove"
                    onClick={() => removeMember(m)}
                  >
                    Leave
                  </button>
                ) : null}
              </div>
            );
          })}
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
        <h2 className="ms-section__title">Event / Moment</h2>
        <p className="ms-section__hint">
          Turn this Mind into a Moment — a shareable event others can drop captures into
          via a link or QR code.
        </p>
        <button
          type="button"
          className={`ms-toggle ${mind.event_mode ? 'ms-toggle--on' : ''}`}
          onClick={() =>
            patchEvent(
              { eventMode: !mind.event_mode },
              mind.event_mode ? 'Event mode off.' : 'Event mode on.',
            )
          }
          role="switch"
          aria-checked={!!mind.event_mode}
        >
          <span className="ms-toggle__dot" />
          <span className="ms-toggle__label">
            {mind.event_mode ? 'This Mind is a Moment' : 'Turn on event mode'}
          </span>
        </button>

        {mind.event_mode ? (
          <>
            <label className="ms-field" style={{ marginTop: 16 }}>
              <span className="ms-field__label">
                Starts <span className="ms-field__optional">— optional</span>
              </span>
              <input
                type="datetime-local"
                className="ms-input"
                defaultValue={
                  mind.event_at ? new Date(mind.event_at).toISOString().slice(0, 16) : ''
                }
                onBlur={(e) =>
                  patchEvent(
                    {
                      eventAt: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                    },
                    'Start time saved.',
                  )
                }
              />
            </label>

            <label className="ms-field" style={{ marginTop: 12 }}>
              <span className="ms-field__label">
                Ends <span className="ms-field__optional">— optional</span>
              </span>
              <input
                type="datetime-local"
                className="ms-input"
                defaultValue={
                  mind.event_end_at
                    ? new Date(mind.event_end_at).toISOString().slice(0, 16)
                    : ''
                }
                onBlur={(e) =>
                  patchEvent(
                    {
                      eventEndAt: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                    },
                    'End time saved.',
                  )
                }
              />
            </label>

            <button
              type="button"
              className={`ms-toggle ${mind.allow_anonymous_contributions ? 'ms-toggle--on' : ''}`}
              onClick={() =>
                patchEvent(
                  { allowAnonymousContributions: !mind.allow_anonymous_contributions },
                  'Updated.',
                )
              }
              role="switch"
              aria-checked={!!mind.allow_anonymous_contributions}
              style={{ marginTop: 16 }}
            >
              <span className="ms-toggle__dot" />
              <span className="ms-toggle__label">
                {mind.allow_anonymous_contributions
                  ? 'Anyone with the link can contribute'
                  : 'Allow anonymous contributions'}
              </span>
            </button>
            <p className="ms-section__hint">
              {mind.allow_anonymous_contributions
                ? 'Visitors can add captures without signing in — credited to you.'
                : 'Off — only signed-in members can add to this Moment.'}
            </p>

            {mind.share_code && momentUrl ? (
              <div className="ms-field" style={{ marginTop: 16 }}>
                <span className="ms-field__label">Share link</span>
                <div className="ms-share">
                  <code className="ms-share__url">{momentUrl}</code>
                  <button
                    type="button"
                    className="ms-btn ms-btn--ghost"
                    onClick={copyMomentLink}
                  >
                    {copiedMoment ? 'Copied' : 'Copy'}
                  </button>
                </div>
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrDataUrl}
                    alt="QR code for this Moment"
                    className="ms-qr"
                    width={180}
                    height={180}
                  />
                ) : null}
              </div>
            ) : null}
          </>
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
  );
}
