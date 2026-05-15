'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { EssayMarkdown } from '@/components/essay-markdown';
import { authedFetch } from '@/lib/client-auth';

type Essay = {
  id: string;
  title: string | null;
  body_md: string;
  source_node_ids: string[];
  provider: string | null;
  model: string | null;
  created_at: string;
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

  useEffect(() => {
    loadMind();
    loadEssays();
  }, [loadMind, loadEssays]);

  const generate = async () => {
    setIsGenerating(true);
    setStatus('Synthesizing across this Mind…');
    setDormant(false);
    const r = await authedFetch('/api/essays', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: mindId }),
    });
    const d = await r.json();
    setIsGenerating(false);
    if (r.status === 503) {
      setDormant(true);
      setStatus('');
      return;
    }
    if (!r.ok) {
      setStatus(d.error ?? 'Could not generate an essay.');
      return;
    }
    setStatus('');
    if (d.essay) {
      setEssays((current) => [d.essay as Essay, ...current]);
      setOpenId((d.essay as Essay).id);
    }
  };

  const openEssay = essays.find((e) => e.id === openId) ?? null;

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
            <span className="ms-crumb__current">essays</span>
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

        {essays.length === 0 && !dormant ? (
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
                      {relativeTime(e.created_at)} · {e.source_node_ids.length} sources
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <article className="essays-reader">
              {openEssay ? (
                <>
                  <p className="essays-reader__meta">
                    {relativeTime(openEssay.created_at)} · {openEssay.source_node_ids.length} sources
                    {openEssay.model ? ` · ${openEssay.model}` : ''}
                  </p>
                  <EssayMarkdown source={openEssay.body_md} />
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
