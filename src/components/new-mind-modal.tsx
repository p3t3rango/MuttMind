'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { authedFetch } from '@/lib/client-auth';

type Privacy = 'solo' | 'shared';
type Mode = 'form' | 'creating' | 'success';

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
  const [privacy, setPrivacy] = useState<Privacy>('solo');
  const [description, setDescription] = useState('');
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
    setPrivacy('solo');
    setDescription('');
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

    if (privacy === 'shared') {
      const inviteRes = await authedFetch('/api/invites', {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      });
      const inviteData = await inviteRes.json();
      if (inviteRes.ok && inviteData.invite?.token) {
        setShareLink(`${window.location.origin}/invite/${inviteData.invite.token}`);
      }
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

  const stayOnList = () => {
    onClose();
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

            <fieldset className="mm-field" disabled={mode === 'creating'}>
              <legend className="mm-field__label">Privacy</legend>
              <div className="mm-options">
                <label
                  className={`mm-option ${privacy === 'solo' ? 'mm-option--selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="privacy"
                    value="solo"
                    checked={privacy === 'solo'}
                    onChange={() => setPrivacy('solo')}
                  />
                  <span className="mm-option__name">Solo</span>
                  <span className="mm-option__hint">Just you. No invite.</span>
                </label>
                <label
                  className={`mm-option ${privacy === 'shared' ? 'mm-option--selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="privacy"
                    value="shared"
                    checked={privacy === 'shared'}
                    onChange={() => setPrivacy('shared')}
                  />
                  <span className="mm-option__name">Shared</span>
                  <span className="mm-option__hint">Generates a share link you can send.</span>
                </label>
              </div>
            </fieldset>

            <label className="mm-field">
              <span className="mm-field__label">Description <span className="mm-field__optional">— optional</span></span>
              <input
                className="mm-field__input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A one-liner about what this Mind is for"
                autoComplete="off"
                disabled={mode === 'creating'}
              />
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
              Your Mind is ready. {shareLink ? 'Send the share link below to anyone you want to join.' : 'Tailor the assistant to it any time from the Mind.'}
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
              <button type="button" className="mm-text-button" onClick={stayOnList}>
                Stay on Minds
              </button>
              <button type="button" className="mm-primary" onClick={openMindAndClose}>
                Open Mind
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
