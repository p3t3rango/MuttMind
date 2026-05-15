'use client';

import { useEffect, useState } from 'react';

type Milestone = {
  key: string;
  label: string;
  done: boolean;
  /** Optional click handler that nudges the user toward completing this step. */
  onAction?: () => void;
  /** Force the milestone to render as complete even if `done` is false. */
  manuallyCheckable?: boolean;
};

const STORAGE_KEY_DISMISSED = 'muttmind:activation-dismissed';
const STORAGE_KEY_MANUAL = 'muttmind:activation-manual';

export function ActivationChecklist({ milestones }: { milestones: Milestone[] }) {
  const [dismissed, setDismissed] = useState(false);
  const [manuallyDone, setManuallyDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY_DISMISSED) === '1');
      const raw = window.localStorage.getItem(STORAGE_KEY_MANUAL);
      if (raw) setManuallyDone(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  const persistManual = (next: Set<string>) => {
    try {
      window.localStorage.setItem(STORAGE_KEY_MANUAL, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };

  const toggleManual = (key: string) => {
    setManuallyDone((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistManual(next);
      return next;
    });
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY_DISMISSED, '1');
    } catch {
      /* ignore */
    }
  };

  if (dismissed) return null;

  const enriched = milestones.map((m) => ({
    ...m,
    done: m.done || manuallyDone.has(m.key),
  }));
  const completedCount = enriched.filter((m) => m.done).length;
  const total = enriched.length;
  if (total === 0 || completedCount === total) return null;

  return (
    <aside className="activation" role="complementary" aria-label="Setup checklist">
      <header className="activation__head">
        <span className="activation__label">
          Finish setup <span className="activation__count">{completedCount}/{total}</span>
        </span>
        <button type="button" className="activation__close" onClick={dismiss} aria-label="Dismiss">
          ×
        </button>
      </header>
      <ul className="activation__list">
        {enriched.map((m) => (
          <li key={m.key} className={`activation__item ${m.done ? 'activation__item--done' : ''}`}>
            <button
              type="button"
              className="activation__checkbox"
              onClick={() => {
                if (m.manuallyCheckable && !m.done) {
                  toggleManual(m.key);
                  return;
                }
                if (m.manuallyCheckable && manuallyDone.has(m.key)) {
                  toggleManual(m.key);
                  return;
                }
              }}
              aria-label={m.done ? 'Done' : 'Mark done'}
              tabIndex={m.manuallyCheckable ? 0 : -1}
            >
              {m.done ? '✓' : ''}
            </button>
            {m.onAction && !m.done ? (
              <button type="button" className="activation__action" onClick={m.onAction}>
                {m.label}
              </button>
            ) : (
              <span className="activation__text">{m.label}</span>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
