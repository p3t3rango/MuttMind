'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivationChecklist } from '@/components/activation-checklist';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { Dropdown } from '@/components/dropdown';
import { NewMindModal } from '@/components/new-mind-modal';
import { authedFetch, getSupabaseBrowser } from '@/lib/client-auth';

type Workspace = {
  role: string;
  workspaces: { id: string; name: string; created_at: string; member_count?: number };
};

type Tag = {
  id: string;
  shift_name: string;
  description: string | null;
};

type CaptureItem = {
  id: string;
  is_processing?: boolean;
  created_by_label?: string;
  created_at?: string;
  title: string | null;
  original_url: string | null;
  og_image_url: string | null;
  source_description: string | null;
  source_author: string | null;
  raw_text: string | null;
  user_notes: string | null;
  ai_summary: string | null;
  tags: string[];
};

type NodeNote = {
  id: string;
  body: string;
  created_at: string;
  created_by: string | null;
  users?: {
    display_name?: string | null;
    email?: string | null;
  } | null;
};

const URL_PATTERN = /https?:\/\/\S+/i;

function getHostLabel(url: string | null) {
  if (!url) return 'note';

  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function relativeTimeFrom(iso?: string) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = (Date.now() - then) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

function getCaptureType(captureItem: CaptureItem) {
  const url = captureItem.original_url ?? '';
  const lower = url.toLowerCase();

  if (!url) return 'note';
  if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/.test(lower)) return 'image';
  if (/\.(mp4|mov|webm|m4v)(\?|$)/.test(lower) || /(youtube|vimeo|tiktok)\./.test(lower)) return 'video';
  if (/\.pdf(\?|$)/.test(lower)) return 'pdf';
  return 'link';
}

function getCardVariant(captureItem: CaptureItem, index: number) {
  const type = getCaptureType(captureItem);
  if (!captureItem.original_url) return 'note';
  if (captureItem.og_image_url) return index % 3 === 0 ? 'tall' : index % 4 === 0 ? 'wide' : 'image';
  if (type === 'pdf') return 'document';
  if (type === 'video') return 'video';
  return 'link';
}

function matchesQuery(captureItem: CaptureItem, query: string) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (!terms.length || URL_PATTERN.test(query)) return true;

  const tags = captureItem.tags.map((tag) => tag.toLowerCase());
  const host = getHostLabel(captureItem.original_url).toLowerCase();
  const type = getCaptureType(captureItem);
  const creator = (captureItem.created_by_label ?? '').toLowerCase();
  const haystack = [
    captureItem.title,
    captureItem.original_url,
    captureItem.source_description,
    captureItem.source_author,
    captureItem.raw_text,
    captureItem.ai_summary,
    host,
    type,
    creator,
    ...tags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return terms.every((term) => {
    if (term.startsWith('#')) return tags.some((tag) => tag.includes(term.slice(1)));
    if (term.startsWith('type:')) return type === term.slice(5);
    if (term.startsWith('site:')) return host.includes(term.slice(5));
    if (term.startsWith('by:') || term.startsWith('from:')) return creator.includes(term.split(':').slice(1).join(':'));
    return haystack.includes(term);
  });
}

function getMindLabel(workspace: Workspace | undefined) {
  if (!workspace) return 'Choose Mind';
  return (workspace.workspaces.member_count ?? 1) > 1 ? 'Shared Mind' : 'Mind';
}

function formatMindName(name: string) {
  return name.replace(/\s+workspace$/i, '');
}

function getNoteAuthorLabel(note: NodeNote) {
  return note.users?.display_name || note.users?.email || 'teammate';
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get('q') ?? '';
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [recentCaptures, setRecentCaptures] = useState<CaptureItem[]>([]);
  const [selectedCapture, setSelectedCapture] = useState<CaptureItem | null>(null);
  const [nodeNotes, setNodeNotes] = useState<NodeNote[]>([]);
  const [status, setStatus] = useState('');
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [captureDraft, setCaptureDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTagSaving, setIsTagSaving] = useState(false);
  const [isNoteSaving, setIsNoteSaving] = useState(false);
  const [isNotesLoading, setIsNotesLoading] = useState(false);
  const [isImproving, setIsImproving] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [newMindModalOpen, setNewMindModalOpen] = useState(false);

  const filteredCaptures = useMemo(
    () => recentCaptures.filter((captureItem) => matchesQuery(captureItem, searchQuery)),
    [recentCaptures, searchQuery],
  );
  const currentWorkspace = workspaces.find((workspace) => workspace.workspaces.id === workspaceId);
  const telegramBotUrl = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL ?? '';

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

  const loadWorkspaces = useCallback(async () => {
    const r = await authedFetch('/api/workspaces');
    const d = await r.json();
    const nextWorkspaces = d.workspaces ?? [];
    setWorkspaces(nextWorkspaces);
    setWorkspaceId((current) => current || nextWorkspaces[0]?.workspaces?.id || '');
  }, []);

  const loadTags = useCallback(async () => {
    if (!workspaceId) {
      setTags([]);
      return;
    }
    const r = await authedFetch(`/api/tags?workspaceId=${workspaceId}`);
    const d = await r.json();
    setTags(d.tags ?? []);
  }, [workspaceId]);

  const loadRecentCaptures = useCallback(async () => {
    if (!workspaceId) {
      setRecentCaptures([]);
      return [] as CaptureItem[];
    }

    const r = await authedFetch(`/api/nodes?workspaceId=${workspaceId}`);
    const d = await r.json();
    const nodes = (d.nodes ?? []) as CaptureItem[];
    setRecentCaptures(nodes);
    return nodes;
  }, [workspaceId]);

  const saveCapture = useCallback(
    async (text: string) => {
      if (!workspaceId) {
        setStatus('Create or choose a Mind first.');
        return false;
      }

      const draft = text.trim();
      if (!draft) {
        setStatus('Paste a link or write a note first.');
        return false;
      }

      const url = draft.match(URL_PATTERN)?.[0];
      const optimisticId = `pending-${Date.now()}`;
      const optimisticCapture: CaptureItem = {
        id: optimisticId,
        is_processing: true,
        title: url ? getHostLabel(url) : draft.slice(0, 80),
        original_url: url ?? null,
        og_image_url: null,
        source_description: 'MuttMind is reading this source now.',
        source_author: null,
        raw_text: draft,
        user_notes: null,
        ai_summary: null,
        created_by_label: 'you',
        tags: [],
      };

      setRecentCaptures((current) => [optimisticCapture, ...current]);
      setIsSaving(true);
      setStatus(url ? 'Saving link and organizing it...' : 'Saving note and organizing it...');
      const r = await authedFetch('/api/capture', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          url,
          rawText: draft,
        }),
      });
      const d = await r.json();
      setIsSaving(false);
      if (!r.ok) {
        setRecentCaptures((current) => current.filter((captureItem) => captureItem.id !== optimisticId));
        setStatus(d.error ?? 'Unable to save that.');
        return false;
      }

      setStatus(
        d.warnings?.length
          ? `Saved, but processing needs attention: ${d.warnings[0]}`
          : 'Saved. Summary, tags, and relationships are being built.',
      );
      await loadTags();
      await loadRecentCaptures();
      return true;
    },
    [loadRecentCaptures, loadTags, workspaceId],
  );

  const updateCapture = useCallback((nodeId: string, patch: Partial<CaptureItem>) => {
    setRecentCaptures((current) =>
      current.map((captureItem) => (captureItem.id === nodeId ? { ...captureItem, ...patch } : captureItem)),
    );
    setSelectedCapture((current) => (current?.id === nodeId ? { ...current, ...patch } : current));
  }, []);

  const updateCaptureTags = useCallback((nodeId: string, nextTags: string[]) => {
    updateCapture(nodeId, { tags: nextTags });
  }, [updateCapture]);

  const loadSelectedNotes = useCallback(async () => {
    if (!workspaceId || !selectedCapture || selectedCapture.id.startsWith('pending-')) {
      setNodeNotes([]);
      return;
    }

    setIsNotesLoading(true);
    const response = await authedFetch(
      `/api/nodes/${selectedCapture.id}/notes?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    const data = await response.json();
    setIsNotesLoading(false);

    if (!response.ok) {
      setStatus(data.error ?? 'Unable to load notes.');
      return;
    }

    setNodeNotes((data.notes ?? []) as NodeNote[]);
  }, [selectedCapture, workspaceId]);

  const saveSelectedNotes = useCallback(async () => {
    if (!workspaceId || !selectedCapture || selectedCapture.id.startsWith('pending-')) return false;
    const body = noteDraft.trim();
    if (!body) return false;

    setIsNoteSaving(true);
    setStatus('Saving note...');
    const response = await authedFetch(`/api/nodes/${selectedCapture.id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, body }),
    });
    const data = await response.json();
    setIsNoteSaving(false);

    if (!response.ok) {
      setStatus(data.error ?? 'Unable to save note.');
      return false;
    }

    setNodeNotes((current) => [data.note as NodeNote, ...current]);
    setNoteDraft('');
    setStatus('Note added. Summary unchanged.');
    return true;
  }, [noteDraft, selectedCapture, workspaceId]);

  const deleteSelectedNote = useCallback(async (noteId: string) => {
    if (!workspaceId || !selectedCapture || selectedCapture.id.startsWith('pending-')) return;

    const previousNotes = nodeNotes;
    setNodeNotes((current) => current.filter((note) => note.id !== noteId));
    const response = await authedFetch(
      `/api/nodes/${selectedCapture.id}/notes?workspaceId=${encodeURIComponent(workspaceId)}&noteId=${encodeURIComponent(noteId)}`,
      { method: 'DELETE' },
    );
    const data = await response.json();

    if (!response.ok) {
      setNodeNotes(previousNotes);
      setStatus(data.error ?? 'Unable to delete note.');
      return;
    }

    setStatus('Note deleted. Summary unchanged.');
  }, [nodeNotes, selectedCapture, workspaceId]);

  const improveSelectedSummary = useCallback(async () => {
    if (!workspaceId || !selectedCapture || selectedCapture.id.startsWith('pending-')) return;

    setIsImproving(true);
    setStatus('Using saved notes to improve summary and tags...');
    const response = await authedFetch(`/api/nodes/${selectedCapture.id}/improve`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    });
    const data = await response.json();
    setIsImproving(false);

    if (!response.ok) {
      setStatus(data.error ?? 'Unable to improve summary.');
      return;
    }

    const nextTags = Array.from(new Set([...(selectedCapture.tags ?? []), ...((data.tags ?? []) as string[])])).sort();
    updateCapture(selectedCapture.id, {
      ai_summary: data.summary ?? selectedCapture.ai_summary,
      tags: nextTags,
    });
    await loadTags();
    setStatus(
      data.warnings?.length
        ? `Improved, but one step needs attention: ${data.warnings[0]}`
        : 'Summary and tags improved.',
    );
  }, [loadTags, selectedCapture, updateCapture, workspaceId]);

  const addTagToSelectedCapture = useCallback(async () => {
    const tag = tagDraft.trim();
    if (!workspaceId || !selectedCapture || !tag || selectedCapture.id.startsWith('pending-')) return;

    setIsTagSaving(true);
    const response = await authedFetch(`/api/nodes/${selectedCapture.id}/tags`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, tag }),
    });
    const data = await response.json();
    setIsTagSaving(false);

    if (!response.ok) {
      setStatus(data.error ?? 'Unable to add tag.');
      return;
    }

    const nextTag = data.tag as string;
    const nextTags = Array.from(new Set([...(selectedCapture.tags ?? []), nextTag])).sort();
    updateCaptureTags(selectedCapture.id, nextTags);
    setTagDraft('');
    setStatus(`Added #${nextTag}.`);
    await loadTags();
  }, [loadTags, selectedCapture, tagDraft, updateCaptureTags, workspaceId]);

  const removeTagFromSelectedCapture = useCallback(
    async (tag: string) => {
      if (!workspaceId || !selectedCapture || selectedCapture.id.startsWith('pending-')) return;

      const nextTags = (selectedCapture.tags ?? []).filter((item) => item !== tag);
      updateCaptureTags(selectedCapture.id, nextTags);
      const response = await authedFetch(
        `/api/nodes/${selectedCapture.id}/tags?workspaceId=${encodeURIComponent(workspaceId)}&tag=${encodeURIComponent(tag)}`,
        { method: 'DELETE' },
      );
      const data = await response.json();

      if (!response.ok) {
        updateCaptureTags(selectedCapture.id, selectedCapture.tags ?? []);
        setStatus(data.error ?? 'Unable to remove tag.');
        return;
      }

      setStatus(`Removed #${tag}.`);
    },
    [selectedCapture, updateCaptureTags, workspaceId],
  );


  const createSharedMind = async () => {
    const name = workspaceNameDraft.trim();
    if (!name) {
      setStatus('Name the Mind first.');
      return;
    }

    setStatus('Creating Mind...');
    const r = await authedFetch('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    const d = await r.json();
    if (!r.ok) {
      setStatus(d.error ?? 'Unable to create Mind.');
      return;
    }

    setWorkspaceNameDraft('');
    setWorkspaceId(d.workspace?.id ?? '');
    setStatus('Mind created.');
    await loadWorkspaces();
  };

  const deleteCapture = async (nodeId: string) => {
    if (!workspaceId || nodeId.startsWith('pending-')) return;
    if (!window.confirm('Delete this capture from the Mind?')) return;

    const r = await authedFetch(`/api/nodes?workspaceId=${workspaceId}&nodeId=${nodeId}`, {
      method: 'DELETE',
    });
    const d = await r.json();
    if (!r.ok) {
      setStatus(d.error ?? 'Unable to delete capture.');
      return;
    }

    setRecentCaptures((current) => current.filter((captureItem) => captureItem.id !== nodeId));
    setSelectedCapture((current) => (current?.id === nodeId ? null : current));
    setStatus('Capture deleted.');
  };

  useEffect(() => {
    getSupabaseBrowser().auth.getSession().then(loadWorkspaces);
  }, [loadWorkspaces]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 700px)');
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    loadTags();
    loadRecentCaptures();
  }, [loadRecentCaptures, loadTags]);

  useEffect(() => {
    setNoteDraft('');
    void loadSelectedNotes();
  }, [loadSelectedNotes, selectedCapture?.id]);

  useEffect(() => {
    const storedMindId = window.localStorage.getItem('muttmind:active-mind-id');
    if (storedMindId) {
      setWorkspaceId(storedMindId);
      window.localStorage.removeItem('muttmind:active-mind-id');
    }
  }, []);

  // Deep-link: opening a capture from the vault graph (or anywhere) sets
  // muttmind:focus-capture-id. Once the workspace is known, fetch that single
  // capture and open its drawer — it may be older than the recent slice, so
  // we fetch it directly rather than searching the loaded list.
  useEffect(() => {
    if (!workspaceId) return;
    const focusId = window.localStorage.getItem('muttmind:focus-capture-id');
    if (!focusId) return;
    window.localStorage.removeItem('muttmind:focus-capture-id');

    let cancelled = false;
    (async () => {
      const existing = recentCaptures.find((c) => c.id === focusId);
      if (existing) {
        if (!cancelled) setSelectedCapture(existing);
        return;
      }
      const r = await authedFetch(
        `/api/nodes/${encodeURIComponent(focusId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      if (!r.ok) return;
      const d = await r.json();
      if (!cancelled && d.node) setSelectedCapture(d.node as CaptureItem);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable),
      );
      const text = event.clipboardData?.getData('text')?.trim() ?? '';
      if (isEditable || !URL_PATTERN.test(text)) return;

      event.preventDefault();
      void saveCapture(text);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [saveCapture]);

  return (
    <main className="app-shell mind-shell">
      <AppNav active="dashboard" />

      <section className="dash-page" aria-labelledby="dashboard-title">
        <h1 id="dashboard-title" className="sr-only">Captures</h1>

        <header className="dash-header">
          <div className="dash-crumb">
            <Dropdown
              value={workspaceId}
              options={[
                { value: '', name: 'no mind selected' },
                ...workspaces.map((workspace) => ({
                  value: workspace.workspaces.id,
                  name: formatMindName(workspace.workspaces.name),
                })),
              ]}
              onChange={(v) => setWorkspaceId(v)}
              ariaLabel="Active Mind"
              size="inline"
            />
            <span className="dash-crumb__sep">/</span>
            <span className="dash-crumb__count">
              {filteredCaptures.length} {filteredCaptures.length === 1 ? 'capture' : 'captures'}
            </span>
          </div>
          <div className="dash-actions">
            <button type="button" className="dash-action" onClick={openTelegramBot}>
              Open Bot
            </button>
            <button type="button" className="dash-action" onClick={() => setNewMindModalOpen(true)}>
              New Mind <span aria-hidden="true">+</span>
            </button>
          </div>
        </header>

        <nav className="dash-pivots" aria-label="View">
          <Link href="/minds" className="dash-pivot">Minds</Link>
          <span className="dash-pivot dash-pivot--active">Captures</span>
          <Link href="/vault" className="dash-pivot">Map</Link>
        </nav>

        {!workspaces.length ? (
          <div className="dash-empty-setup">
            <p className="dash-empty-setup__hint">You don't have a Mind yet.</p>
            <button type="button" className="button" onClick={() => setNewMindModalOpen(true)}>
              + New Mind
            </button>
          </div>
        ) : (
          <>
            <form
              className="dash-capture"
              onSubmit={async (event) => {
                event.preventDefault();
                const saved = await saveCapture(captureDraft);
                if (saved) setCaptureDraft('');
              }}
            >
              <textarea
                className="dash-capture__input"
                value={captureDraft}
                placeholder="Paste a link or write a note…"
                onChange={(event) => setCaptureDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
              />
              <div className="dash-capture__row">
                <span className="dash-capture__hint">⌘ + Enter to save</span>
                <button type="submit" className="dash-capture__submit" disabled={isSaving || !captureDraft.trim()}>
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>

            {status || tags.length ? (
              <p className="dash-status" aria-live="polite">
                {status || `${tags.length} tags`}
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="mind-board" aria-label="Saved captures">
        {filteredCaptures.length > 0 ? (
          <div className="masonry-grid">
            {filteredCaptures.map((captureItem, index) => {
              const variant = getCardVariant(captureItem, index);

              return (
                <article key={captureItem.id} className={`mind-card mind-card--${variant}`}>
                  <button
                    type="button"
                    className="mind-card__button"
                    onClick={() => setSelectedCapture(captureItem)}
                    aria-label={`Inspect ${captureItem.title ?? 'saved item'}`}
                  >
                  {captureItem.is_processing ? (
                    <span className="mind-card__processing">Reading source...</span>
                  ) : captureItem.og_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={captureItem.og_image_url} alt={captureItem.title ?? 'Saved preview'} />
                    ) : variant === 'note' ? (
                      <span className="mind-card__note">
                        {captureItem.raw_text || captureItem.ai_summary || captureItem.title || 'Untitled note'}
                      </span>
                    ) : (
                      <span className="mind-card__fallback">{getHostLabel(captureItem.original_url)}</span>
                    )}
                  </button>

                  <button type="button" className="mind-card__meta" onClick={() => setSelectedCapture(captureItem)}>
                    <span className="mind-card__title">{captureItem.title ?? 'Untitled capture'}</span>
                    <span className="mind-card__attribution" aria-hidden="true">
                      Added by {captureItem.created_by_label ?? 'teammate'}
                      {relativeTimeFrom(captureItem.created_at) ? ` · ${relativeTimeFrom(captureItem.created_at)}` : ''}
                    </span>
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="dash-empty">
            {searchQuery ? (
              <>
                <p className="dash-empty__title">No matches yet.</p>
                <p className="dash-empty__hint">Clear the search to see everything.</p>
              </>
            ) : (
              <>
                <p className="dash-empty__title">Save your first capture to start this Mind.</p>
                <div className="dash-empty__paths" role="list">
                  <button
                    type="button"
                    className="dash-empty__path"
                    onClick={() => {
                      const composer = document.querySelector<HTMLTextAreaElement>('.dash-capture__input');
                      composer?.focus();
                    }}
                    role="listitem"
                  >
                    <span className="dash-empty__path-icon" aria-hidden="true">⎘</span>
                    <span className="dash-empty__path-name">Paste link</span>
                  </button>
                  <button
                    type="button"
                    className="dash-empty__path"
                    onClick={() => {
                      const composer = document.querySelector<HTMLTextAreaElement>('.dash-capture__input');
                      composer?.focus();
                    }}
                    role="listitem"
                  >
                    <span className="dash-empty__path-icon" aria-hidden="true">≡</span>
                    <span className="dash-empty__path-name">Write a note</span>
                  </button>
                  <button
                    type="button"
                    className="dash-empty__path dash-empty__path--soon"
                    disabled
                    title="Upload — coming soon"
                    role="listitem"
                  >
                    <span className="dash-empty__path-icon" aria-hidden="true">⤒</span>
                    <span className="dash-empty__path-name">Upload</span>
                    <span className="dash-empty__path-soon">soon</span>
                  </button>
                </div>
                <button
                  type="button"
                  className="dash-empty__bot"
                  onClick={openTelegramBot}
                >
                  or save from anywhere — open the Telegram bot →
                </button>
              </>
            )}
          </div>
        )}
      </section>

      {selectedCapture ? (
        <div className="capture-drawer capture-drawer--wide" role="dialog" aria-modal="true" aria-label="Saved capture details">
          <button className="capture-drawer__backdrop" aria-label="Close details" onClick={() => setSelectedCapture(null)} />
          <aside className="capture-drawer__panel">
            <button className="capture-drawer__close" onClick={() => setSelectedCapture(null)}>
              Close
            </button>
            <div className="capture-drawer__preview">
              {selectedCapture.og_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedCapture.og_image_url} alt={selectedCapture.title ?? 'Saved preview'} />
              ) : (
                <div className="signal-card__thumb signal-card__thumb--fallback">
                  <span>{getHostLabel(selectedCapture.original_url)}</span>
                </div>
              )}
            </div>
            <div className="capture-drawer__body">
              <p className="eyebrow">{getHostLabel(selectedCapture.original_url)}</p>
              <h2>{selectedCapture.title ?? 'Untitled capture'}</h2>
              <div className="tldr-box">
                <p className="kicker">TLDR</p>
                <p>{selectedCapture.is_processing ? 'MuttMind is reading the source, writing the summary, and assigning tags.' : selectedCapture.ai_summary || selectedCapture.source_description || 'No summary yet.'}</p>
              </div>
              <div>
                <p className="kicker">MuttMind tags</p>
                {selectedCapture.is_processing ? (
                  <p className="meta">Tags are generating now.</p>
                ) : selectedCapture.tags?.length ? (
                  <div className="tag-cloud tag-cloud--editable">
                    {selectedCapture.tags.map((tag) => (
                      <span key={tag} className="soft-pill soft-pill--editable">
                        {tag}
                        <button
                          type="button"
                          aria-label={`Remove ${tag}`}
                          onClick={() => removeTagFromSelectedCapture(tag)}
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="meta">Tags will appear after MuttMind processes this capture.</p>
                )}
                {!selectedCapture.id.startsWith('pending-') ? (
                  <form
                    className="tag-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      addTagToSelectedCapture();
                    }}
                  >
                    <input
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      placeholder="Add a tag"
                      aria-label="Add a tag"
                    />
                    <button type="submit" disabled={isTagSaving || !tagDraft.trim()}>
                      Add Tag
                    </button>
                  </form>
                ) : null}
              </div>
              <div>
                <p className="kicker">Notes</p>
                {selectedCapture.user_notes ? (
                  <div className="saved-notes">
                    <article className="saved-note saved-note--initial">
                      <p>{selectedCapture.user_notes}</p>
                      <span>Initial capture note</span>
                    </article>
                  </div>
                ) : null}
                {isNotesLoading ? <p className="meta">Loading notes...</p> : null}
                {nodeNotes.length ? (
                  <div className="saved-notes">
                    {nodeNotes.map((note) => (
                      <article key={note.id} className="saved-note">
                        <p>{note.body}</p>
                        <span>{getNoteAuthorLabel(note)}</span>
                        <button type="button" onClick={() => deleteSelectedNote(note.id)} aria-label="Delete note">
                          Delete
                        </button>
                      </article>
                    ))}
                  </div>
                ) : !selectedCapture.user_notes && !isNotesLoading ? (
                  <p className="meta">No notes yet.</p>
                ) : null}
                <textarea
                  className="mind-note-input"
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="Add context, why you saved this, or what MuttMind missed. This will not change the summary until you choose Improve Summary."
                />
                {!selectedCapture.id.startsWith('pending-') ? (
                  <div className="note-actions">
                    <button
                      className="button-secondary"
                      type="button"
                      onClick={saveSelectedNotes}
                      disabled={isNoteSaving || !noteDraft.trim()}
                    >
                      {isNoteSaving ? 'Saving' : 'Add Note'}
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={improveSelectedSummary}
                      disabled={isImproving}
                    >
                      {isImproving ? 'Improving' : 'Improve Summary'}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="button-row">
                {selectedCapture.original_url ? (
                  <a className="button-secondary" href={selectedCapture.original_url} target="_blank" rel="noreferrer">
                    Open Source
                  </a>
                ) : null}
                <Link href="/vault" className="button-secondary">
                  View Map
                </Link>
                {!selectedCapture.is_processing ? (
                  <button className="button-ghost" onClick={() => deleteCapture(selectedCapture.id)}>
                    Delete
                  </button>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <NewMindModal
        open={newMindModalOpen}
        onClose={() => setNewMindModalOpen(false)}
        onCreated={() => loadWorkspaces()}
      />

      <ActivationChecklist
        milestones={[
          {
            key: 'mind',
            label: 'Create your first Mind',
            done: workspaces.length > 0,
          },
          {
            key: 'capture',
            label: 'Save your first capture',
            done: recentCaptures.length > 0,
          },
          {
            key: 'tailor',
            label: 'Tailor your assistant',
            done: false,
            manuallyCheckable: true,
            onAction: () => {
              if (currentWorkspace?.workspaces.id) {
                window.location.href = `/minds/${currentWorkspace.workspaces.id}/tailor`;
              }
            },
          },
          {
            key: 'shared',
            label: 'Make it a Shared Mind',
            done: (currentWorkspace?.workspaces.member_count ?? 1) > 1,
            onAction: () => setNewMindModalOpen(true),
          },
          {
            key: 'telegram',
            label: 'Connect the Telegram bot',
            done: false,
            manuallyCheckable: true,
            onAction: openTelegramBot,
          },
        ]}
      />
    </main>
  );
}

export default function Dashboard() {
  return (
    <AuthGate>
      <DashboardContent />
    </AuthGate>
  );
}
