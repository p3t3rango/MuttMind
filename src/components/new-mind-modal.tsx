'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Dropdown } from '@/components/dropdown';
import { authedFetch } from '@/lib/client-auth';

type Privacy = 'open' | 'closed' | 'private';
type Mode = 'form' | 'creating' | 'success';

const PRIVACY_OPTIONS: { value: Privacy; name: string; hint: string; tone: 'open' | 'closed' | 'private' }[] = [
  {
    value: 'open',
    name: 'Open',
    hint: 'Anyone can view and add to this Mind.',
    tone: 'open',
  },
  {
    value: 'closed',
    name: 'Closed',
    hint: 'Anyone can view; only collaborators can add.',
    tone: 'closed',
  },
  {
    value: 'private',
    name: 'Private',
    hint: 'Only collaborators can view or add.',
    tone: 'private',
  },
];

type NewMindModalProps = {
  open: boolean;
  onClose: () => void;
  /** Called after a Mind is fully created. Receives the new workspace id. */
  onCreated?: (workspaceId: string) => void;
};

export function NewMindModal({ open, onClose, onCreated }: NewMindModalProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('form');
  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('closed');
  const [description, setDescription] = useState('');
  const [isEvent, setIsEvent] = useState(false);
  const [createdMindId, setCreatedMindId] = useState('');
  const [createdMindName, setCreatedMindName] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setMode('form');
    setName('');
    setPrivacy('closed');
    setDescription('');
    setIsEvent(false);
    setCreatedMindId('');
    setCreatedMindName('');
    setShareLink('');
    setCopied(false);
    setError('');
  }, [open]);

  // Focus the name input when the form opens. Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => nameInputRef.current?.focus(), 50);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // ESC closes the modal. The Dropdown component handles its own ESC for the
  // open menu; if it's already closed, this fires.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required.');
      return;
    }
    setError('');
    setMode('creating');

    const createRes = await authedFetch('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({
        name: trimmedName,
        description: description.trim() || undefined,
        privacy,
        eventMode: isEvent || undefined,
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok || !createData.workspace?.id) {
      setError(createData.error ?? 'Could not create Mind.');
      setMode('form');
      return;
    }

    const workspaceId = createData.workspace.id as string;
    setCreatedMindId(workspaceId);
    setCreatedMindName(createData.workspace.name as string);

    // Generate a share link for any non-private mode (Open and Closed both
    // benefit from a link; Private also generates one so the user can invite
    // collaborators). Once public read/write routes ship for Open and Closed,
    // those modes will have a different "share link" (the public URL itself).
    const inviteRes = await authedFetch('/api/invites', {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    });
    const inviteData = await inviteRes.json();
    if (inviteRes.ok && inviteData.invite?.token) {
      setShareLink(`${window.location.origin}/invite/${inviteData.invite.token}`);
    }

    onCreated?.(workspaceId);
    setMode('success');
  };

  const copyShareLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may not be available in non-secure contexts; quiet failure.
    }
  };

  const openMindAndClose = () => {
    if (createdMindId) {
      window.localStorage.setItem('muttmind:active-mind-id', createdMindId);
    }
    onClose();
    router.push('/dashboard');
  };

  const openTailorAndClose = () => {
    if (!createdMindId) return;
    onClose();
    router.push(`/minds/${createdMindId}/tailor`);
  };

  return (
    <div className="mm-modal-backdrop" onClick={onClose} aria-hidden="false">
      <div
        className="mm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-mind-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mm-modal__header">
          <p className="mm-eyebrow">{mode === 'success' ? 'Mind created' : 'New Mind'}</p>
          <button type="button" className="mm-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {mode !== 'success' ? (
          <form className="mm-modal__body" onSubmit={handleCreate}>
            <label className="mm-field">
              <span className="mm-field__label">Name</span>
              <input
                ref={nameInputRef}
                className="mm-field__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Q3 brand refresh research"
                autoComplete="off"
                disabled={mode === 'creating'}
              />
            </label>

            <div className="mm-field">
              <span className="mm-field__label">Privacy</span>
              <Dropdown
                value={privacy}
                options={PRIVACY_OPTIONS}
                onChange={(v) => setPrivacy(v)}
                disabled={mode === 'creating'}
                ariaLabel="Privacy"
                size="modal"
              />
              <span className="mm-field__optional">
                {PRIVACY_OPTIONS.find((opt) => opt.value === privacy)?.hint}
              </span>
            </div>

            <label className="mm-field">
              <span className="mm-field__label">Description <span className="mm-field__optional">— optional</span></span>
              <textarea
                className="mm-field__textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A one-liner about what this Mind is for"
                rows={2}
                disabled={mode === 'creating'}
              />
            </label>

            <label className="mm-event-opt">
              <input
                type="checkbox"
                checked={isEvent}
                onChange={(e) => setIsEvent(e.target.checked)}
                disabled={mode === 'creating'}
              />
              <span>
                <span className="mm-field__label">Make this an event (Moment)</span>
                <span className="mm-field__optional">
                  Get a shareable link + QR so others can contribute. You can refine
                  date and anonymous access in settings.
                </span>
              </span>
            </label>

            {error ? <p className="mm-error">{error}</p> : null}

            <div className="mm-actions">
              <button type="button" className="mm-text-button" onClick={onClose} disabled={mode === 'creating'}>
                Cancel
              </button>
              <button type="submit" className="mm-primary" disabled={mode === 'creating' || !name.trim()}>
                {mode === 'creating' ? 'Creating…' : 'Create Mind'}
              </button>
            </div>
          </form>
        ) : (
          <div className="mm-modal__body">
            <p className="mm-success__name">{createdMindName}</p>
            <p className="mm-success__hint">
              Your Mind is ready. The next step shapes how its assistant talks and what it pays attention to — you can skip and do it later.
            </p>

            {shareLink ? (
              <div className="mm-field">
                <span className="mm-field__label">Share link</span>
                <div className="mm-share">
                  <code className="mm-share__url">{shareLink}</code>
                  <button type="button" className="mm-text-button" onClick={copyShareLink}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <span className="mm-field__optional">Open in any browser, sign in, and the visitor joins as a member. Expires in 14 days.</span>
              </div>
            ) : null}

            <div className="mm-actions">
              <button type="button" className="mm-text-button" onClick={openMindAndClose}>
                Skip — open Mind
              </button>
              <button type="button" className="mm-primary" onClick={openTailorAndClose}>
                Tailor your assistant
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
