'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { EssayMarkdown } from '@/components/essay-markdown';
import { authedFetch } from '@/lib/client-auth';

type Citation = {
  index: number;
  nodeId: string;
  title: string | null;
  url: string | null;
  similarity: number;
};

type Exchange = {
  question: string;
  answer: string;
  citations: Citation[];
};

function AskContent() {
  const params = useParams<{ id: string }>();
  const mindId = params.id;

  const [mindName, setMindName] = useState('');
  const [query, setQuery] = useState('');
  const [thread, setThread] = useState<Exchange[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [dormant, setDormant] = useState(false);
  const [status, setStatus] = useState('');

  const loadMind = useCallback(async () => {
    const r = await authedFetch('/api/workspaces');
    const d = await r.json();
    const found = (d.workspaces ?? []).find(
      (row: { workspaces?: { id: string } }) => row.workspaces?.id === mindId,
    );
    if (found?.workspaces) setMindName(found.workspaces.name);
  }, [mindId]);

  useEffect(() => {
    loadMind();
  }, [loadMind]);

  const ask = async () => {
    const q = query.trim();
    if (!q || isAsking) return;
    setIsAsking(true);
    setStatus('Reading the Mind…');
    setDormant(false);
    const r = await authedFetch('/api/ask', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: mindId, query: q }),
    });
    setIsAsking(false);
    setStatus('');
    if (r.status === 503) {
      setDormant(true);
      return;
    }
    const d = await r.json();
    if (!r.ok) {
      setStatus(d.error ?? 'Could not answer.');
      return;
    }
    setThread((current) => [
      { question: q, answer: d.answer ?? '', citations: (d.citations ?? []) as Citation[] },
      ...current,
    ]);
    setQuery('');
  };

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
            <span className="ms-crumb__current">ask</span>
          </div>
          <Link href={`/minds/${mindId}/essays`} className="ms-open">
            Essays →
          </Link>
        </header>

        <div className="ask-input">
          <textarea
            className="ms-textarea"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void ask();
              }
            }}
            placeholder="Ask this Mind anything — what's the through-line of what I've saved on X? where do these sources disagree?"
            rows={3}
          />
          <div className="ask-input__row">
            <span className="ask-input__hint">⌘ + Enter to ask</span>
            <button type="button" className="ms-btn" onClick={ask} disabled={isAsking || !query.trim()}>
              {isAsking ? 'Asking…' : 'Ask'}
            </button>
          </div>
        </div>

        {status ? <p className="ms-status">{status}</p> : null}

        {dormant ? (
          <div className="essays-dormant">
            <p className="essays-dormant__title">Ask is dormant.</p>
            <p className="essays-dormant__body">
              The retrieval + answer pipeline is built but gated. Add{' '}
              <code>MUTTMIND_ASK_ENABLED=1</code> to <code>.env.local</code> and restart, then ask
              again.
            </p>
          </div>
        ) : null}

        {thread.length === 0 && !dormant ? (
          <p className="ms-section__hint" style={{ paddingTop: 16 }}>
            Ask retrieves the most relevant captures from this Mind, then answers grounded only in
            them — with citations back to the sources.
          </p>
        ) : null}

        <div className="ask-thread">
          {thread.map((x, i) => (
            <article key={i} className="ask-exchange">
              <p className="ask-exchange__q">{x.question}</p>
              <div className="ask-exchange__a">
                <EssayMarkdown source={x.answer} />
              </div>
              {x.citations.length ? (
                <ol className="ask-citations">
                  {x.citations.map((c) => (
                    <li key={c.nodeId} className="ask-citation">
                      <span className="ask-citation__idx">[{c.index}]</span>
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noreferrer" className="ask-citation__link">
                          {c.title ?? c.url}
                        </a>
                      ) : (
                        <span>{c.title ?? 'Untitled'}</span>
                      )}
                    </li>
                  ))}
                </ol>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default function AskPage() {
  return (
    <AuthGate>
      <AskContent />
    </AuthGate>
  );
}
