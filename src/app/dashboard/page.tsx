'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
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
  title: string | null;
  original_url: string | null;
  og_image_url: string | null;
  source_description: string | null;
  source_author: string | null;
  raw_text: string | null;
  ai_summary: string | null;
  tags: string[];
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

function DashboardContent() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [recentCaptures, setRecentCaptures] = useState<CaptureItem[]>([]);
  const [selectedCapture, setSelectedCapture] = useState<CaptureItem | null>(null);
  const [status, setStatus] = useState('');
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const filteredCaptures = useMemo(
    () => recentCaptures.filter((captureItem) => matchesQuery(captureItem, searchQuery)),
    [recentCaptures, searchQuery],
  );
  const currentWorkspace = workspaces.find((workspace) => workspace.workspaces.id === workspaceId);

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
      return;
    }

    const r = await authedFetch(`/api/nodes?workspaceId=${workspaceId}`);
    const d = await r.json();
    setRecentCaptures((d.nodes ?? []) as CaptureItem[]);
  }, [workspaceId]);

  const saveCapture = useCallback(
    async (text: string) => {
      if (!workspaceId) {
        setStatus('Create or choose a Mind first.');
        return;
      }

      const draft = text.trim();
      if (!draft) {
        setStatus('Paste a link or write a note first.');
        return;
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
        return;
      }

      setSearchQuery('');
      setStatus(d.warnings?.length ? 'Saved. Some relationship features are still catching up.' : 'Saved. Summary, tags, and relationships are being built.');
      await loadTags();
      await loadRecentCaptures();
    },
    [loadRecentCaptures, loadTags, workspaceId],
  );

  const saveSmartSpace = () => {
    const query = searchQuery.trim();
    if (!query || URL_PATTERN.test(query)) {
      setStatus('Search or filter first, then save that view as a Smart Space.');
      return;
    }
    if (!workspaceId) {
        setStatus('Choose a Mind first.');
      return;
    }

    const fallbackName = query.startsWith('#') ? query.slice(1) : query;
    const name = window.prompt('Name this Smart Space', fallbackName);
    if (!name?.trim()) return;

    authedFetch('/api/spaces', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        name: name.trim(),
        query,
        color: '#7c3aed',
      }),
    }).then(async (response) => {
      const data = await response.json();
      setStatus(response.ok ? `Smart Space saved: ${name.trim()}.` : data.error ?? 'Unable to save Smart Space.');
    });
  };

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

  useEffect(() => {
    getSupabaseBrowser().auth.getSession().then(loadWorkspaces);
  }, [loadWorkspaces]);

  useEffect(() => {
    loadTags();
    loadRecentCaptures();
  }, [loadRecentCaptures, loadTags]);

  useEffect(() => {
    const storedQuery = window.localStorage.getItem('muttmind:active-space-query');
    const storedMindId = window.localStorage.getItem('muttmind:active-mind-id');
    if (storedQuery) {
      setSearchQuery(storedQuery);
      window.localStorage.removeItem('muttmind:active-space-query');
    }
    if (storedMindId) {
      setWorkspaceId(storedMindId);
      window.localStorage.removeItem('muttmind:active-mind-id');
    }
  }, []);

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

      <section className="mind-home" aria-labelledby="dashboard-title">
        <h1 id="dashboard-title" className="sr-only">Everything</h1>
        <div className="mind-home__bar">
          <label className="mind-search">
            <span className="sr-only">Search or paste into MuttMind</span>
            <input
              value={searchQuery}
              placeholder="Search MuttMind..."
              onChange={(e) => setSearchQuery(e.target.value)}
              onPaste={(event) => {
                const text = event.clipboardData.getData('text').trim();
                if (!URL_PATTERN.test(text)) return;
                event.preventDefault();
                void saveCapture(text);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void saveCapture(searchQuery);
                }
              }}
            />
          </label>

          <div className="mind-home__tools">
            <label className="mind-select mind-select--quiet">
              <span className="sr-only">Shared Mind</span>
              <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                <option value="">Choose Mind</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.workspaces.id} value={workspace.workspaces.id}>
                    {formatMindName(workspace.workspaces.name)}
                  </option>
                ))}
              </select>
            </label>
            <button className="mind-action" onClick={saveSmartSpace}>
              Save as Space
            </button>
          </div>
        </div>

        <div className="mind-status-row">
          <span>{status || 'Paste a link anywhere. Type #tag, type:video, site:domain, or by:name to search.'}</span>
          <span>{isSaving ? 'Saving...' : `${filteredCaptures.length} visible`}</span>
          <span>{tags.length ? `${tags.length} tags` : 'Auto-tagging on'}</span>
          <span>{currentWorkspace ? `${formatMindName(currentWorkspace.workspaces.name)} / ${getMindLabel(currentWorkspace)}` : 'No Mind selected'}</span>
          <Link href="/vault">Relationship map</Link>
        </div>

        {!workspaces.length ? (
          <div className="mind-empty-setup">
            <h2>Create your first Mind.</h2>
            <div className="mind-toolbar__create">
              <input
                aria-label="New Mind name"
                placeholder="Research, culture shifts, studio..."
                value={workspaceNameDraft}
                onChange={(e) => setWorkspaceNameDraft(e.target.value)}
              />
              <button className="button" onClick={createSharedMind}>
                Create
              </button>
            </div>
          </div>
        ) : null}
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
                    {captureItem.original_url ? <span className="mind-card__source">{getHostLabel(captureItem.original_url)}</span> : null}
                  </button>

                  <button type="button" className="mind-card__title" onClick={() => setSelectedCapture(captureItem)}>
                    {captureItem.title ?? 'Untitled capture'}
                  </button>
                  <p className="mind-card__creator">Added by {captureItem.created_by_label ?? 'teammate'}</p>

                  {captureItem.tags?.length ? (
                    <div className="mind-card__tags">
                      {captureItem.tags.slice(0, 4).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mind-empty">
            <h2>{searchQuery ? 'No matches yet.' : 'Paste a link to begin.'}</h2>
            <p>{searchQuery ? 'Clear the search or save this query as a Smart Space.' : 'MuttMind will create a visual card, summarize it, and tag it automatically.'}</p>
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
                  <div className="tag-cloud">
                    {selectedCapture.tags.map((tag) => (
                      <span key={tag} className="soft-pill">{tag}</span>
                    ))}
                  </div>
                ) : (
                  <p className="meta">Tags will appear after MuttMind processes this capture.</p>
                )}
              </div>
              <div>
                <p className="kicker">Notes</p>
                <textarea className="mind-note-input" placeholder="Type here to add a note..." />
              </div>
              <div className="button-row">
                {selectedCapture.original_url ? (
                  <a className="button" href={selectedCapture.original_url} target="_blank" rel="noreferrer">
                    Open Source
                  </a>
                ) : null}
                <Link href="/vault" className="button-secondary">
                  View Map
                </Link>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
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
