'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { authedFetch } from '@/lib/client-auth';

type Mode = 'essay' | 'brief' | 'questions';
type Phase = 'choose' | 'running' | 'dormant' | 'error';

const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: 'essay', label: 'Essay', blurb: 'The full argument across everything saved.' },
  { id: 'brief', label: 'Brief', blurb: 'One strong through-line, tight.' },
  { id: 'questions', label: 'Open questions', blurb: 'What the material circles but never resolves.' },
];

const STEPS: Record<Mode, string[]> = {
  essay: ['Reading the material', 'Tracing what rhymes', 'Finding the through-line', 'Writing'],
  brief: ['Reading the material', 'Weighing the threads', 'Tightening to one idea'],
  questions: ['Reading the material', "Listening for what's unresolved", 'Sharpening the questions'],
};

type SynthesizeModalProps = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  mindName?: string;
  captureCount?: number;
};

export function SynthesizeModal({
  open,
  onClose,
  workspaceId,
  mindName,
  captureCount,
}: SynthesizeModalProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('essay');
  const [phase, setPhase] = useState<Phase>('choose');
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopSteps = () => {
    if (stepTimer.current) {
      clearInterval(stepTimer.current);
      stepTimer.current = null;
    }
  };

  useEffect(() => {
    if (!open) return;
    setMode('essay');
    setPhase('choose');
    setStep(0);
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      stopSteps();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'running') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, phase]);

  if (!open) return null;

  const run = async () => {
    setPhase('running');
    setStep(0);
    setError('');
    const steps = STEPS[mode];
    stopSteps();
    stepTimer.current = setInterval(() => {
      setStep((s) => (s < steps.length - 1 ? s + 1 : s));
    }, 5500);

    try {
      const r = await authedFetch('/api/essays', {
        method: 'POST',
        body: JSON.stringify({ workspaceId, mode }),
      });
      const d = await r.json();
      if (r.status === 503) {
        setPhase('dormant');
        return;
      }
      if (!r.ok) {
        setError(d.error ?? 'Could not synthesize.');
        setPhase('error');
        return;
      }
      stopSteps();
      onClose();
      router.push(`/minds/${workspaceId}/essays`);
    } catch {
      setError('Something interrupted synthesis. Try again.');
      setPhase('error');
    } finally {
      stopSteps();
    }
  };

  return (
    <div
      className="mm-modal-backdrop"
      onClick={() => phase !== 'running' && onClose()}
      aria-hidden="false"
    >
      <div
        className="mm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="synthesize-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mm-modal__header">
          <p className="mm-eyebrow" id="synthesize-title">
            Synthesize{mindName ? ` · ${mindName}` : ''}
            {typeof captureCount === 'number'
              ? ` · ${captureCount} ${captureCount === 1 ? 'capture' : 'captures'}`
              : ''}
          </p>
          {phase !== 'running' ? (
            <button type="button" className="mm-modal__close" onClick={onClose} aria-label="Close">
              ×
            </button>
          ) : null}
        </header>

        {phase === 'running' ? (
          <div className="mm-modal__body">
            <div className="syn-loading" aria-live="polite" style={{ borderBottom: 'none', padding: '8px 0 4px' }}>
              <ol className="syn-loading__steps">
                {STEPS[mode].map((label, i) => (
                  <li
                    key={label}
                    className={i < step ? 'is-done' : i === step ? 'is-active' : 'is-pending'}
                  >
                    {label}
                  </li>
                ))}
              </ol>
              <p className="syn-loading__note">One pass, end to end — usually 20–40 seconds.</p>
            </div>
          </div>
        ) : phase === 'dormant' ? (
          <div className="mm-modal__body">
            <p className="mm-success__hint">
              Synthesis is built but gated so it can&apos;t spend tokens by accident. Add{' '}
              <code>MUTTMIND_SYNTHESIS_ENABLED=1</code> to <code>.env.local</code> and restart the
              dev server, then try again.
            </p>
            <div className="mm-actions">
              <button type="button" className="mm-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="mm-modal__body">
            <div className="syn-choices" role="radiogroup" aria-label="Output type">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  className={`syn-choice ${mode === m.id ? 'syn-choice--on' : ''}`}
                  onClick={() => setMode(m.id)}
                >
                  <span className="syn-choice__label">{m.label}</span>
                  <span className="syn-choice__blurb">{m.blurb}</span>
                </button>
              ))}
            </div>

            {typeof captureCount === 'number' && captureCount < 3 ? (
              <p className="syn-thin-note">
                {captureCount === 0
                  ? 'Nothing saved here yet — add a few captures before synthesizing.'
                  : `Only ${captureCount} ${captureCount === 1 ? 'capture' : 'captures'} here. Synthesis works by connecting sources; with this few it can only do a close reading. Three or more gives it a real thread to pull.`}
              </p>
            ) : null}

            {error ? <p className="mm-error">{error}</p> : null}

            <div className="mm-actions">
              <button type="button" className="mm-text-button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="mm-primary"
                onClick={run}
                disabled={captureCount === 0}
              >
                {typeof captureCount === 'number' && captureCount < 3 && captureCount > 0
                  ? 'Synthesize anyway'
                  : 'Synthesize'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
