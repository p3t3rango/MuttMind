'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { detectUrlKind } from '@/lib/detect';

type Moment = {
  name: string;
  description: string | null;
  eventAt: string | null;
  eventEndAt: string | null;
  allowAnonymous: boolean;
};

export default function MomentPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;

  const [moment, setMoment] = useState<Moment | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const [savedCount, setSavedCount] = useState(0);

  const detection = useMemo(() => detectUrlKind(draft), [draft]);

  useEffect(() => {
    fetch(`/api/moments/${code}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          setLoadError(d.error ?? 'This event link is not active.');
          return;
        }
        setMoment(d.moment as Moment);
      })
      .catch(() => setLoadError('Could not load this event.'));
  }, [code]);

  const contribute = async () => {
    if (!draft.trim()) return;
    setSubmitting(true);
    setStatus('');
    try {
      const isUrl = Boolean(detection.url);
      const r = await fetch(`/api/moments/${code}/capture`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(isUrl ? { url: detection.url } : { rawText: draft }),
      });
      const d = await r.json();
      if (!r.ok) {
        setStatus(d.error ?? 'Could not add that.');
        return;
      }
      setDraft('');
      setSavedCount((n) => n + 1);
      setStatus('Added to the Moment. Thank you.');
    } catch {
      setStatus('Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-page" aria-labelledby="moment-title">
          <h1 id="moment-title" className="auth-page__title">Event unavailable</h1>
          <p className="ms-section__hint">{loadError}</p>
        </section>
      </main>
    );
  }

  if (!moment) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-page">
          <p className="ms-loading">Loading…</p>
        </section>
      </main>
    );
  }

  const fmtMoment = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const dateLabel = moment.eventAt
    ? moment.eventEndAt
      ? `${fmtMoment(moment.eventAt)} → ${fmtMoment(moment.eventEndAt)}`
      : fmtMoment(moment.eventAt)
    : '';

  return (
    <main className="app-shell auth-shell">
      <section className="auth-page" aria-labelledby="moment-title">
        <header className="auth-page__head">
          <p className="auth-page__crumb">moment</p>
          <h1 id="moment-title" className="auth-page__title">{moment.name}</h1>
          {dateLabel ? <p className="ms-section__hint">{dateLabel}</p> : null}
          {moment.description ? (
            <p className="ms-section__hint">{moment.description}</p>
          ) : null}
        </header>

        {moment.allowAnonymous ? (
          <div className="insight-compose" style={{ marginTop: 24 }}>
            <textarea
              className="insight-compose__body"
              placeholder="Add a link or a note to this Moment…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
            />
            {draft.trim() ? (
              <p className={`dash-detect dash-detect--${detection.kind}`}>
                <span className="dash-detect__dot" aria-hidden="true" />
                {detection.provider && detection.kind !== 'note'
                  ? `${detection.provider} · ${detection.label}`
                  : detection.label}
              </p>
            ) : null}
            <div className="insight-compose__actions">
              {status ? <span className="ms-section__hint">{status}</span> : null}
              <button
                type="button"
                className="ms-btn"
                onClick={contribute}
                disabled={submitting || !draft.trim()}
              >
                {submitting ? 'Adding…' : 'Add to Moment'}
              </button>
            </div>
            {savedCount > 0 ? (
              <p className="ms-section__hint">
                {savedCount} contribution{savedCount === 1 ? '' : 's'} this visit.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="ms-section__hint" style={{ marginTop: 24 }}>
            This Moment isn&apos;t accepting open contributions right now.
          </p>
        )}
      </section>
    </main>
  );
}
