'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AskPanel } from '@/components/ask-panel';
import { AuthGate } from '@/components/auth-gate';
import { EssayMarkdown, type EssaySource } from '@/components/essay-markdown';
import { authedFetch } from '@/lib/client-auth';

type Essay = {
  id: string;
  title: string | null;
  body_md: string;
  source_node_ids: string[];
  provider: string | null;
  model: string | null;
  trail: { kind?: string; origin?: string } | null;
  created_at: string;
};

function essayKindLabel(trail: Essay['trail']): string {
  const k = trail?.kind;
  if (k === 'digest') return 'Weekly Digest';
  if (k === 'brief') return 'Brief';
  if (k === 'questions') return 'Open questions';
  if (k === 'custom-prompt') return 'Custom';
  return 'Essay';
}

type Insight = {
  id: string;
  title: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  source_kind?: string | null;
  source_node_id?: string | null;
  feeds_priming?: boolean;
  author?: { display_name: string | null; email: string | null } | null;
};

function sourceLabel(kind?: string | null): string {
  if (!kind) return '';
  if (kind === 'essay') return 'from a synthesis';
  if (kind.startsWith('lens:')) return `from the ${kind.slice(5).replace(/-/g, ' ')} lens`;
  return `from ${kind}`;
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = (Date.now() - then) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / (86400 * 30))}mo ago`;
}

function digestPreview(body: string): string {
  const stripped = body.replace(/^#\s+[^\n]+\n+/, '');
  const firstPara = stripped.split(/\n\s*\n/)[0] ?? '';
  const cleaned = firstPara
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>]/g, '')
    .trim();
  return cleaned.length > 240 ? `${cleaned.slice(0, 240).trim()}…` : cleaned;
}

function EssaysContent() {
  const params = useParams<{ id: string }>();
  const mindId = params.id;

  const [mindName, setMindName] = useState('');
  const [essays, setEssays] = useState<Essay[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [nodeMeta, setNodeMeta] = useState<Map<string, { title: string; url: string | null }>>(
    new Map(),
  );
  const [insights, setInsights] = useState<Insight[]>([]);
  const [composeTitle, setComposeTitle] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteEssayId, setConfirmDeleteEssayId] = useState<string | null>(null);
  const [olderDigestsOpen, setOlderDigestsOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pastOpen, setPastOpen] = useState(false);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('ask') === '1') setAskOpen(true);
  }, []);

  const loadMind = useCallback(async () => {
    const r = await authedFetch('/api/workspaces');
    const d = await r.json();
    const found = (d.workspaces ?? []).find(
      (row: { workspaces?: { id: string } }) => row.workspaces?.id === mindId,
    );
    if (found?.workspaces) setMindName(found.workspaces.name);
  }, [mindId]);

  const loadEssays = useCallback(async () => {
    const r = await authedFetch(`/api/essays?workspaceId=${mindId}`);
    const d = await r.json();
    if (r.ok) {
      const list = (d.essays ?? []) as Essay[];
      setEssays(list);
      setOpenId((current) => {
        if (current) return current;
        const firstEssay = list.find((e) => e.trail?.kind !== 'digest');
        return firstEssay?.id ?? null;
      });
    }
  }, [mindId]);

  const loadNodeMeta = useCallback(async () => {
    const r = await authedFetch(`/api/nodes?workspaceId=${mindId}`);
    const d = await r.json();
    if (r.ok) {
      const m = new Map<string, { title: string; url: string | null }>();
      for (const n of (d.nodes ?? []) as {
        id: string;
        title: string | null;
        original_url: string | null;
      }[]) {
        m.set(n.id, { title: n.title ?? 'Untitled', url: n.original_url });
      }
      setNodeMeta(m);
    }
  }, [mindId]);

  const loadInsights = useCallback(async () => {
    const r = await authedFetch(`/api/insights?workspaceId=${mindId}`);
    const d = await r.json();
    if (r.ok) setInsights((d.insights ?? []) as Insight[]);
  }, [mindId]);

  useEffect(() => {
    loadMind();
    loadEssays();
    loadNodeMeta();
    loadInsights();
  }, [loadMind, loadEssays, loadNodeMeta, loadInsights]);

  const createInsight = async () => {
    if (!composeBody.trim()) return;
    setComposeBusy(true);
    try {
      const r = await authedFetch('/api/insights', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: mindId, title: composeTitle, body: composeBody }),
      });
      const d = await r.json();
      if (r.ok && d.insight) {
        setInsights((cur) => [d.insight as Insight, ...cur]);
        setComposeTitle('');
        setComposeBody('');
      }
    } finally {
      setComposeBusy(false);
    }
  };

  const togglePriming = async (id: string, next: boolean) => {
    setInsights((cur) => cur.map((x) => (x.id === id ? { ...x, feeds_priming: next } : x)));
    const r = await authedFetch('/api/insights', {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId: mindId, id, feedsPriming: next }),
    });
    if (!r.ok) {
      setInsights((cur) => cur.map((x) => (x.id === id ? { ...x, feeds_priming: !next } : x)));
    }
  };

  const removeInsight = async (id: string) => {
    const r = await authedFetch(`/api/insights?workspaceId=${mindId}&id=${id}`, {
      method: 'DELETE',
    });
    if (r.ok) {
      setInsights((cur) => cur.filter((x) => x.id !== id));
      setConfirmDeleteId(null);
    }
  };

  const deleteEssay = async (id: string) => {
    const r = await authedFetch(`/api/essays?workspaceId=${mindId}&id=${id}`, {
      method: 'DELETE',
    });
    if (r.ok) {
      setEssays((cur) => cur.filter((e) => e.id !== id));
      setOpenId((cur) => (cur === id ? null : cur));
      setConfirmDeleteEssayId(null);
    }
  };

  const [savedEssayId, setSavedEssayId] = useState<string | null>(null);
  const saveEssayToInsights = async (id: string, title: string | null, body: string) => {
    const r = await authedFetch('/api/insights', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: mindId,
        title: title || 'Synthesis',
        body,
        sourceKind: 'essay',
      }),
    });
    if (r.ok) {
      setSavedEssayId(id);
      loadInsights();
    }
  };

  const openEssay = essays.find((e) => e.id === openId) ?? null;
  const openSources: EssaySource[] = openEssay
    ? openEssay.source_node_ids.map((id, idx) => ({
        n: idx + 1,
        title: nodeMeta.get(id)?.title ?? 'Untitled',
        url: nodeMeta.get(id)?.url ?? null,
      }))
    : [];

  const digests = essays.filter((e) => e.trail?.kind === 'digest');
  const nonDigests = essays.filter((e) => e.trail?.kind !== 'digest');
  const latestDigest = digests[0] ?? null;
  const olderDigests = digests.slice(1);

  const q = query.trim().toLowerCase();
  const matches = (i: Insight) => !q || `${i.title ?? ''} ${i.body}`.toLowerCase().includes(q);
  const yours = insights.filter((i) => (i.source_kind ?? null) === null && matches(i));
  const synthesized = insights.filter((i) => (i.source_kind ?? null) !== null && matches(i));

  const renderInsightCard = (it: Insight) => (
    <li key={it.id} className="insight-item">
      {it.title ? <p className="insight-item__title">{it.title}</p> : null}
      <p className="insight-item__body">{it.body}</p>
      <div className="insight-item__meta">
        <span>
          {it.author?.display_name || it.author?.email || 'Unknown'}
          {' · '}{relativeTime(it.updated_at)}
          {it.source_kind ? ` · ${sourceLabel(it.source_kind)}` : ''}
        </span>
        <span className="insight-item__actions">
          <button
            type="button"
            className={`prime-toggle ${it.feeds_priming !== false ? 'prime-toggle--on' : ''}`}
            onClick={() => togglePriming(it.id, it.feeds_priming === false)}
            title={it.feeds_priming !== false ? 'Feeding the Mind — click to mute' : 'Muted — click to feed the Mind'}
          >
            {it.feeds_priming !== false ? '● feeds the Mind' : '○ muted'}
          </button>
          {confirmDeleteId === it.id ? (
            <>
              <button type="button" className="insight-link insight-link--danger" onClick={() => removeInsight(it.id)}>Confirm delete</button>
              <button type="button" className="insight-link" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="insight-link" onClick={() => setConfirmDeleteId(it.id)}>Delete</button>
          )}
        </span>
      </div>
    </li>
  );

  return (
    <main className="app-shell ms-shell">
      <AppNav active="minds" />

      <section className="ms-page essays-page">
        <header className="ms-top">
          <div className="ms-crumb">
            <Link href="/minds" className="ms-crumb__link">minds</Link>
            <span className="ms-crumb__sep">/</span>
            <span>{mindName || 'Mind'}</span>
            <span className="ms-crumb__sep">/</span>
            <span className="ms-crumb__current">insights</span>
          </div>
          <button type="button" className="ms-btn" onClick={() => setAskOpen(true)}>Ask ✦</button>
        </header>

        <nav className="dash-pivots" aria-label="View">
          <Link href="/minds" className="dash-pivot">Minds</Link>
          <Link href="/dashboard" className="dash-pivot">Dashboard</Link>
          <Link href="/vault" className="dash-pivot">Map</Link>
          <span className="dash-pivot dash-pivot--active">Insights</span>
        </nav>

        <input
          className="library-search"
          type="search"
          value={query}
          placeholder="Search this Mind's library…"
          onChange={(e) => setQuery(e.target.value)}
        />

        {latestDigest ? (
          <section
            className={`digest-hero ${openId === latestDigest.id ? 'digest-hero--active' : ''}`}
            aria-label="Latest weekly digest"
          >
            <button
              type="button"
              className="digest-hero__card"
              onClick={() => {
                if (openId === latestDigest.id) {
                  setOpenId(nonDigests[0]?.id ?? null);
                } else {
                  setOpenId(latestDigest.id);
                  setPastOpen(true);
                }
              }}
            >
              <p className="digest-hero__meta">
                <span className="essays-kind essays-kind--digest">Weekly Digest</span>
                {' · '}
                {relativeTime(latestDigest.created_at)} · {latestDigest.source_node_ids.length}{' '}
                sources
              </p>
              <p className="digest-hero__title">{latestDigest.title ?? 'Untitled digest'}</p>
              <p className="digest-hero__preview">{digestPreview(latestDigest.body_md)}</p>
              <span className="digest-hero__read">
                {openId === latestDigest.id ? 'Reading ↓  ·  Close' : 'Read →'}
              </span>
            </button>
            {olderDigests.length ? (
              <div className="digest-hero__older">
                <button
                  type="button"
                  className="insight-link"
                  onClick={() => setOlderDigestsOpen((v) => !v)}
                  aria-expanded={olderDigestsOpen}
                >
                  {olderDigestsOpen ? 'Hide' : 'Older digests'} ({olderDigests.length})
                </button>
                {olderDigestsOpen ? (
                  <ul className="digest-older-list" role="list">
                    {olderDigests.map((d) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          className={`digest-older-list__item ${openId === d.id ? 'digest-older-list__item--active' : ''}`}
                          onClick={() => setOpenId(d.id)}
                        >
                          <span className="digest-older-list__title">
                            {d.title ?? 'Untitled digest'}
                          </span>
                          <span className="digest-older-list__meta">
                            {relativeTime(d.created_at)} · {d.source_node_ids.length} sources
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="insights-yours">
          <div className="insights-lane-row">
            <p className="insights-lane">Yours <span className="insights-lane__sub">· you wrote these</span></p>
            <button type="button" className="insight-link" onClick={() => setComposeOpen((v) => !v)}>
              {composeOpen ? 'Cancel' : '+ Add an insight'}
            </button>
          </div>
          {composeOpen ? (
            <div className="insight-compose">
              <input
                className="insight-compose__title"
                placeholder="Title (optional)"
                value={composeTitle}
                onChange={(e) => setComposeTitle(e.target.value)}
              />
              <textarea
                className="insight-compose__body"
                placeholder="What are you noticing across this Mind? The assistant reads these when it synthesizes."
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                rows={3}
                autoFocus
              />
              <div className="insight-compose__actions">
                <button
                  type="button"
                  className="ms-btn"
                  onClick={createInsight}
                  disabled={composeBusy || !composeBody.trim()}
                >
                  {composeBusy ? 'Saving…' : 'Add insight'}
                </button>
              </div>
            </div>
          ) : null}
          {yours.length ? (
            <ul className="insight-list" role="list">{yours.map(renderInsightCard)}</ul>
          ) : (
            <p className="ms-section__hint">
              No insights yet — jot what you&apos;re noticing. The assistant reads these when it answers.
            </p>
          )}
        </section>

        <section className="insights-yours">
          <div className="insights-lane-row">
            <p className="insights-lane">Synthesized <span className="insights-lane__sub">· the assistant made these</span></p>
          </div>
          {synthesized.length ? (
            <ul className="insight-list" role="list">{synthesized.map(renderInsightCard)}</ul>
          ) : (
            <p className="ms-section__hint">
              Saved chat answers and lens saves land here, muted until you switch them on.
            </p>
          )}
        </section>

        {nonDigests.length || (latestDigest && openId === latestDigest.id) ? (
          <div className="past-syntheses">
            {nonDigests.length ? (
              <button type="button" className="insight-link" onClick={() => setPastOpen((v) => !v)} aria-expanded={pastOpen}>
                {pastOpen ? 'Hide' : 'Past syntheses'} ({nonDigests.length})
              </button>
            ) : null}
            {pastOpen ? (
              <div className="essays-layout">
                <ul className="essays-list" role="list">
                  {nonDigests.length ? (
                    nonDigests.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          className={`essays-list__item ${openId === e.id ? 'essays-list__item--active' : ''}`}
                          onClick={() => setOpenId(e.id)}
                        >
                          <span className="essays-list__title">{e.title ?? 'Untitled essay'}</span>
                          <span className="essays-list__meta">
                            <span className="essays-kind">{essayKindLabel(e.trail)}</span>
                            {' · '}
                            {relativeTime(e.created_at)} · {e.source_node_ids.length} sources
                          </span>
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="essays-list__empty">No past syntheses yet.</li>
                  )}
                </ul>

                <article className="essays-reader">
                  {openEssay ? (
                    <>
                      <div className="essays-reader__head">
                        <p className="essays-reader__meta">
                          {openEssay.trail?.kind === 'digest' ? (
                            <>
                              <button
                                type="button"
                                className="insight-link essays-reader__back"
                                onClick={() => {
                                  const fallback = nonDigests[0]?.id ?? null;
                                  setOpenId(fallback);
                                  document
                                    .querySelector('.essays-page')
                                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }}
                              >
                                ← Close
                              </button>
                              {' · '}
                            </>
                          ) : null}
                          <span
                            className={`essays-kind ${openEssay.trail?.kind === 'digest' ? 'essays-kind--digest' : ''}`}
                          >
                            {essayKindLabel(openEssay.trail)}
                          </span>
                          {' · '}
                          {relativeTime(openEssay.created_at)} · {openEssay.source_node_ids.length}{' '}
                          sources
                          {openEssay.model ? ` · ${openEssay.model}` : ''}
                        </p>
                        <span className="insight-item__actions">
                          <button
                            type="button"
                            className="insight-link"
                            onClick={() =>
                              saveEssayToInsights(openEssay.id, openEssay.title, openEssay.body_md)
                            }
                            disabled={savedEssayId === openEssay.id}
                          >
                            {savedEssayId === openEssay.id ? 'Saved to Yours ✓' : 'Save to Yours'}
                          </button>
                          {confirmDeleteEssayId === openEssay.id ? (
                            <>
                              <button
                                type="button"
                                className="insight-link insight-link--danger"
                                onClick={() => deleteEssay(openEssay.id)}
                              >
                                Confirm delete
                              </button>
                              <button
                                type="button"
                                className="insight-link"
                                onClick={() => setConfirmDeleteEssayId(null)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="insight-link"
                              onClick={() => setConfirmDeleteEssayId(openEssay.id)}
                            >
                              Delete
                            </button>
                          )}
                        </span>
                      </div>
                      <EssayMarkdown source={openEssay.body_md} sources={openSources} />
                    </>
                  ) : (
                    <p className="ms-loading">Select an essay.</p>
                  )}
                </article>
              </div>
            ) : null}
          </div>
        ) : null}

      </section>

      <AskPanel
        open={askOpen}
        onClose={() => setAskOpen(false)}
        workspaceId={mindId}
        mindName={mindName}
        onSaved={loadInsights}
      />
    </main>
  );
}

export default function EssaysPage() {
  return (
    <AuthGate>
      <EssaysContent />
    </AuthGate>
  );
}
