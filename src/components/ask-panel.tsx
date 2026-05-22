'use client';

import { useRef, useState } from 'react';
import { authedFetch, getAccessToken } from '@/lib/client-auth';

type Citation = { index: number; nodeId: string; title: string | null; url: string | null };
type Turn = {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  pending?: boolean;
  savedInsightId?: string;
};

const STARTERS = [
  'Write me a brief on this Mind.',
  "What's unresolved across what I've saved?",
  'Write a full essay synthesizing this Mind.',
];

export function AskPanel({
  open,
  onClose,
  workspaceId,
  mindName,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  mindName: string;
  onSaved: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  };

  const send = async (text: string) => {
    const query = text.trim();
    if (!query || busy || !workspaceId) return;
    setError('');
    setInput('');
    const history: Turn[] = [...turns, { role: 'user', content: query }];
    setTurns([...history, { role: 'assistant', content: '', pending: true }]);
    setBusy(true);
    scrollToEnd();

    try {
      const token = await getAccessToken();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          workspaceId,
          messages: history.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      if (res.status === 503) {
        setError('Chat is dormant. Set MUTTMIND_CHAT_ENABLED=1 and restart the dev server.');
        setTurns((cur) => cur.slice(0, -1));
        return;
      }
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Could not reach the Mind.');
        setTurns((cur) => cur.slice(0, -1));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const apply = (evt: { type: string; text?: string; citations?: Citation[]; error?: string }) => {
        setTurns((cur) => {
          const next = [...cur];
          const last = next[next.length - 1];
          if (!last || last.role !== 'assistant') return cur;
          if (evt.type === 'token') next[next.length - 1] = { ...last, content: last.content + (evt.text ?? ''), pending: false };
          else if (evt.type === 'citations') next[next.length - 1] = { ...last, citations: evt.citations, pending: false };
          else if (evt.type === 'error') next[next.length - 1] = { ...last, content: last.content || `(${evt.error})`, pending: false };
          return next;
        });
        if (evt.type === 'token') scrollToEnd();
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const l of lines) {
          const t = l.trim();
          if (!t) continue;
          try { apply(JSON.parse(t)); } catch { /* partial line; next read completes it */ }
        }
      }
    } catch {
      setError('The connection dropped mid-answer. Try again.');
      setTurns((cur) => cur.slice(0, -1));
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  };

  const saveAnswer = async (idx: number) => {
    const answer = turns[idx];
    const question = turns[idx - 1];
    if (!answer || answer.role !== 'assistant') return;
    const r = await authedFetch('/api/insights', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        title: question?.content?.slice(0, 140) ?? 'From a chat',
        body: answer.content,
        sourceKind: 'chat',
        sourceNodeIds: (answer.citations ?? []).map((c) => c.nodeId),
      }),
    });
    const d = await r.json();
    if (r.ok && d.insight) {
      setTurns((cur) => cur.map((t, i) => (i === idx ? { ...t, savedInsightId: d.insight.id } : t)));
      onSaved();
    }
  };

  if (!open) return null;

  return (
    <div className="ask-panel" role="dialog" aria-modal="false" aria-label={`Ask ${mindName}`}>
      <header className="ask-panel__head">
        <span className="ask-panel__title">Ask {mindName || 'this Mind'}</span>
        <button type="button" className="ask-panel__close" onClick={onClose} aria-label="Close chat">✕</button>
      </header>

      <div className="ask-panel__thread" ref={scrollRef}>
        {turns.length === 0 ? (
          <div className="ask-panel__starters">
            <p className="ask-panel__hint">Ask anything grounded in this Mind, or start with:</p>
            {STARTERS.map((s) => (
              <button key={s} type="button" className="ask-starter" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={`ask-turn ask-turn--${t.role}`}>
              <div className="ask-turn__body">
                {t.pending && !t.content ? <span className="ask-turn__thinking">Thinking…</span> : t.content}
              </div>
              {t.role === 'assistant' && !t.pending && t.content ? (
                <div className="ask-turn__foot">
                  {t.citations?.length ? (
                    <span className="ask-turn__cites">
                      {t.citations.map((c) => (
                        c.url ? (
                          <a key={c.index} href={c.url} target="_blank" rel="noreferrer" className="ask-cite">[{c.index}] {c.title ?? 'source'}</a>
                        ) : (
                          <span key={c.index} className="ask-cite">[{c.index}] {c.title ?? 'source'}</span>
                        )
                      ))}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="insight-link"
                    onClick={() => saveAnswer(i)}
                    disabled={Boolean(t.savedInsightId)}
                  >
                    {t.savedInsightId ? 'Saved to Mind ✓ (muted)' : '＋ Save to Mind'}
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
        {error ? <p className="ask-panel__error">{error}</p> : null}
      </div>

      <form
        className="ask-panel__compose"
        onSubmit={(e) => { e.preventDefault(); send(input); }}
      >
        <textarea
          className="ask-panel__input"
          value={input}
          placeholder="Ask this Mind…"
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(input); }
          }}
        />
        <button type="submit" className="ms-btn" disabled={busy || !input.trim()}>
          {busy ? 'Asking…' : 'Ask'}
        </button>
      </form>
    </div>
  );
}
