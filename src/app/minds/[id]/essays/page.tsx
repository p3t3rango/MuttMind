'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '@/components/app-nav';
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
  author?: { display_name: string | null; email: string | null } | null;
};

function sourceLabel(kind?: string | null): string {
  if (!kind) return '';
  if (kind === 'essay') return 'from a synthesis';
  if (kind.startsWith('lens:')) return `from the ${kind.slice(5).replace(/-/g, ' ')} lens`;
  return `from ${kind}`;
}

type Mode = 'essay' | 'brief' | 'questions';

const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: 'essay', label: 'Essay', blurb: 'The full argument across everything saved.' },
  { id: 'brief', label: 'Brief', blurb: 'One strong through-line, tight.' },
  { id: 'questions', label: 'Open questions', blurb: "What the material circles but never resolves." },
];

const PHASES: Record<Mode, string[]> = {
  essay: ['Reading the material', 'Tracing what rhymes', 'Finding the through-line', 'Writing'],
  brief: ['Reading the material', 'Weighing the threads', 'Tightening to one idea'],
  questions: ['Reading the material', "Listening for what's unresolved", 'Sharpening the questions'],
};

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

function EssaysContent() {
  const params = useParams<{ id: string }>();
  const mindId = params.id;

  const [mindName, setMindName] = useState('');
  const [essays, setEssays] = useState<Essay[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const [dormant, setDormant] = useState(false);
  const [mode, setMode] = useState<Mode>('essay');
  const [phase, setPhase] = useState(0);
  const [nodeMeta, setNodeMeta] = useState<Map<string, { title: string; url: string | null }>>(
    new Map(),
  );
  const [insights, setInsights] = useState<Insight[]>([]);
  const [composeTitle, setComposeTitle] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteEssayId, setConfirmDeleteEssayId] = useState<string | null>(null);
  const phaseTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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
      setOpenId((current) => current ?? list[0]?.id ?? null);
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

  const saveEdit = async (id: string) => {
    if (!editBody.trim()) return;
    const r = await authedFetch('/api/insights', {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId: mindId, id, title: editTitle, body: editBody }),
    });
    const d = await r.json();
    if (r.ok && d.insight) {
      setInsights((cur) => cur.map((x) => (x.id === id ? (d.insight as Insight) : x)));
      setEditingId(null);
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

  const stopPhases = useCallback(() => {
    if (phaseTimer.current) {
      clearInterval(phaseTimer.current);
      phaseTimer.current = null;
    }
  }, []);

  useEffect(() => () => stopPhases(), [stopPhases]);

  const generate = async () => {
    setIsGenerating(true);
    setStatus('');
    setDormant(false);
    setPhase(0);
    stopPhases();
    const steps = PHASES[mode];
    phaseTimer.current = setInterval(() => {
      setPhase((p) => (p < steps.length - 1 ? p + 1 : p));
    }, 5500);

    try {
      const r = await authedFetch('/api/essays', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: mindId, mode }),
      });
      const d = await r.json();
      if (r.status === 503) {
        setDormant(true);
        return;
      }
      if (!r.ok) {
        setStatus(d.error ?? 'Could not generate an essay.');
        return;
      }
      if (d.essay) {
        setEssays((current) => [d.essay as Essay, ...current]);
        setOpenId((d.essay as Essay).id);
      }
    } catch {
      setStatus('Something interrupted synthesis. Try again.');
    } finally {
      stopPhases();
      setIsGenerating(false);
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

  const ownInsights = insights.filter((i) => i.source_kind !== 'learned');
  const learnedInsights = insights.filter((i) => i.source_kind === 'learned');

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
          <button
            type="button"
            className="ms-btn"
            onClick={generate}
            disabled={isGenerating}
          >
            {isGenerating ? 'Synthesizing…' : 'Synthesize'}
          </button>
        </header>

        <nav className="dash-pivots" aria-label="View">
          <Link href="/minds" className="dash-pivot">Minds</Link>
          <Link href="/dashboard" className="dash-pivot">Dashboard</Link>
          <Link href="/vault" className="dash-pivot">Map</Link>
          <span className="dash-pivot dash-pivot--active">Insights</span>
        </nav>

        <section className="insights-yours">
          <div className="insights-lane-row">
            <p className="insights-lane">Yours</p>
            <button
              type="button"
              className="insight-link"
              onClick={() => setComposeOpen((v) => !v)}
            >
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

          {ownInsights.length ? (
            <ul className="insight-list" role="list">
              {ownInsights.map((it) => (
                <li key={it.id} className="insight-item">
                  {editingId === it.id ? (
                    <div className="insight-compose">
                      <input
                        className="insight-compose__title"
                        placeholder="Title (optional)"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                      <textarea
                        className="insight-compose__body"
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={3}
                      />
                      <div className="insight-compose__actions">
                        <button
                          type="button"
                          className="mm-text-button"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="ms-btn"
                          onClick={() => saveEdit(it.id)}
                          disabled={!editBody.trim()}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {it.title ? <p className="insight-item__title">{it.title}</p> : null}
                      <p className="insight-item__body">{it.body}</p>
                      <div className="insight-item__meta">
                        <span>
                          {it.author?.display_name || it.author?.email || 'Unknown'}
                          {' · '}
                          {relativeTime(it.updated_at)}
                          {it.updated_at !== it.created_at ? ' · edited' : ''}
                          {it.source_kind ? ` · ${sourceLabel(it.source_kind)}` : ''}
                        </span>
                        <span className="insight-item__actions">
                          <button
                            type="button"
                            className="insight-link"
                            onClick={() => {
                              setEditingId(it.id);
                              setEditTitle(it.title ?? '');
                              setEditBody(it.body);
                              setConfirmDeleteId(null);
                            }}
                          >
                            Edit
                          </button>
                          {confirmDeleteId === it.id ? (
                            <>
                              <button
                                type="button"
                                className="insight-link insight-link--danger"
                                onClick={() => removeInsight(it.id)}
                              >
                                Confirm delete
                              </button>
                              <button
                                type="button"
                                className="insight-link"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="insight-link"
                              onClick={() => setConfirmDeleteId(it.id)}
                            >
                              Delete
                            </button>
                          )}
                        </span>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ms-section__hint" style={{ paddingTop: 8 }}>
              No insights yet — jot what you&apos;re noticing across this Mind. The assistant
              reads these when it synthesizes.
            </p>
          )}
        </section>

        {learnedInsights.length ? (
          <section className="insights-yours">
            <p className="insights-lane">
              What this Mind has learned
              <span className="insights-lane__sub"> · distilled by the assistant</span>
            </p>
            <ul className="insight-list" role="list">
              {learnedInsights.map((it) => {
                const src = it.source_node_id ? nodeMeta.get(it.source_node_id) : null;
                return (
                  <li key={it.id} className="insight-item">
                    <p className="insight-item__body">{it.body}</p>
                    <div className="insight-item__meta">
                      <span>
                        {src ? (
                          src.url ? (
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="insight-src"
                            >
                              ↳ {src.title}
                            </a>
                          ) : (
                            <span className="insight-src">↳ {src.title}</span>
                          )
                        ) : (
                          'from across this Mind'
                        )}
                        {' · '}
                        {relativeTime(it.updated_at)}
                      </span>
                      <span className="insight-item__actions">
                        {confirmDeleteId === it.id ? (
                          <>
                            <button
                              type="button"
                              className="insight-link insight-link--danger"
                              onClick={() => removeInsight(it.id)}
                            >
                              Confirm delete
                            </button>
                            <button
                              type="button"
                              className="insight-link"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="insight-link"
                            onClick={() => setConfirmDeleteId(it.id)}
                            title="Remove this learning (also drops it from future priming)"
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <p className="insights-lane insights-lane--synth">Synthesized</p>

        <div className="syn-modes" role="tablist" aria-label="Synthesis output">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              className={`syn-mode ${mode === m.id ? 'syn-mode--on' : ''}`}
              onClick={() => setMode(m.id)}
              disabled={isGenerating}
            >
              {m.label}
            </button>
          ))}
          <span className="syn-modes__blurb">
            {MODES.find((m) => m.id === mode)?.blurb}
          </span>
        </div>

        {isGenerating ? (
          <div className="syn-loading" aria-live="polite">
            <ol className="syn-loading__steps">
              {PHASES[mode].map((label, i) => (
                <li
                  key={label}
                  className={
                    i < phase ? 'is-done' : i === phase ? 'is-active' : 'is-pending'
                  }
                >
                  {label}
                </li>
              ))}
            </ol>
            <p className="syn-loading__note">
              One pass, end to end — usually 20–40 seconds.
            </p>
          </div>
        ) : null}

        {status ? <p className="ms-status">{status}</p> : null}

        {dormant ? (
          <div className="essays-dormant">
            <p className="essays-dormant__title">Synthesis is dormant.</p>
            <p className="essays-dormant__body">
              The pipeline is built and ready, but it&apos;s gated so it can&apos;t spend tokens without a
              deliberate switch. To turn it on, add <code>MUTTMIND_SYNTHESIS_ENABLED=1</code> to
              <code>.env.local</code> and restart the dev server, then hit Synthesize again.
            </p>
          </div>
        ) : null}

        {essays.length === 0 && !dormant && !isGenerating ? (
          <p className="ms-section__hint" style={{ paddingTop: 20 }}>
            No essays yet. Synthesize pulls this Mind&apos;s recent captures, finds the resonance between
            them, and writes an essay in the Mind&apos;s configured voice — with citations back to the
            sources.
          </p>
        ) : null}

        {essays.length ? (
          <div className="essays-layout">
            <ul className="essays-list" role="list">
              {essays.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={`essays-list__item ${openId === e.id ? 'essays-list__item--active' : ''}`}
                    onClick={() => setOpenId(e.id)}
                  >
                    <span className="essays-list__title">{e.title ?? 'Untitled essay'}</span>
                    <span className="essays-list__meta">
                      <span
                        className={`essays-kind ${e.trail?.kind === 'digest' ? 'essays-kind--digest' : ''}`}
                      >
                        {essayKindLabel(e.trail)}
                      </span>
                      {' · '}
                      {relativeTime(e.created_at)} · {e.source_node_ids.length} sources
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <article className="essays-reader">
              {openEssay ? (
                <>
                  <div className="essays-reader__head">
                    <p className="essays-reader__meta">
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
      </section>
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
