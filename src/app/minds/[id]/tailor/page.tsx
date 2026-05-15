'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';

type Mind = {
  id: string;
  name: string;
  system_prompt?: string | null;
};

type Step = 1 | 2 | 3 | 4;

const THINKING_PHASES = [
  'Reading your answers',
  'Drawing on the MuttMind ethos',
  'Anchoring to your stance',
  'Shaping the voice',
  'Polishing',
];

const SPINNER_FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

function TailorMindContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const mindId = params.id;

  const [mind, setMind] = useState<Mind | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [purpose, setPurpose] = useState('');
  const [primer, setPrimer] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [tick, setTick] = useState(0);

  // Drive the spinner + phase messages while the LLM is generating. 100ms per
  // tick gives a smooth braille spin; phase swaps every ~1.4s so each line
  // gets a moment to register.
  useEffect(() => {
    if (!isGenerating) {
      setTick(0);
      return;
    }
    const id = window.setInterval(() => setTick((t) => t + 1), 100);
    return () => window.clearInterval(id);
  }, [isGenerating]);

  const spinnerGlyph = SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
  const currentPhase = THINKING_PHASES[Math.floor(tick / 14) % THINKING_PHASES.length];

  // Load Mind metadata so we can show the name and pass it to the generator.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await authedFetch('/api/workspaces');
      const d = await r.json();
      const found = (d.workspaces ?? []).find((row: { workspaces?: { id: string } }) => row.workspaces?.id === mindId);
      if (!cancelled && found?.workspaces) {
        setMind({
          id: found.workspaces.id,
          name: found.workspaces.name,
          system_prompt: found.workspaces.system_prompt,
        });
        if (found.workspaces.system_prompt) {
          setGeneratedPrompt(found.workspaces.system_prompt);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mindId]);

  const openMindAndExit = useCallback(() => {
    if (mindId) {
      window.localStorage.setItem('muttmind:active-mind-id', mindId);
    }
    router.push('/dashboard');
  }, [mindId, router]);

  const generatePrompt = useCallback(async () => {
    if (!mind?.name) return;
    setIsGenerating(true);
    setStatus('');
    const response = await authedFetch('/api/workspaces/generate-prompt', {
      method: 'POST',
      body: JSON.stringify({
        name: mind.name,
        purpose: purpose.trim() || undefined,
        primer: primer.trim() || undefined,
      }),
    });
    const data = await response.json();
    setIsGenerating(false);
    if (!response.ok) {
      setStatus(data.error ?? 'Unable to generate a prompt — you can write one yourself or skip.');
      return;
    }
    setGeneratedPrompt(data.systemPrompt ?? '');
  }, [mind, purpose, primer]);

  const savePrompt = useCallback(async () => {
    if (!mindId || !generatedPrompt.trim()) return;
    setIsSaving(true);
    setStatus('Saving…');
    const response = await authedFetch('/api/workspaces', {
      method: 'PATCH',
      body: JSON.stringify({
        workspaceId: mindId,
        systemPrompt: generatedPrompt.trim(),
      }),
    });
    const data = await response.json();
    setIsSaving(false);
    if (!response.ok) {
      setStatus(data.error ?? 'Unable to save the assistant prompt.');
      return;
    }
    openMindAndExit();
  }, [mindId, generatedPrompt, openMindAndExit]);

  const goNext = () => {
    setStatus('');
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      setStep(3);
      void generatePrompt();
      return;
    }
  };

  const goBack = () => {
    if (step === 1) return;
    setStep((step - 1) as Step);
  };

  if (!mind) {
    return (
      <main className="app-shell mind-shell">
        <AppNav active="minds" />
        <section className="onboarding">
          <p className="onboarding__progress">Loading Mind…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell mind-shell">
      <AppNav active="minds" />

      <section className="onboarding" aria-labelledby="tailor-title">
        <header className="onboarding__header">
          <p className="eyebrow">Tailor the assistant — {mind.name}</p>
          <h1 id="tailor-title" className="onboarding__title">
            {step === 1 && 'What is this Mind for?'}
            {step === 2 && 'Anything to prime the assistant with?'}
            {step === 3 && 'Review the generated system prompt.'}
          </h1>
          <p className="onboarding__progress">Step {step} of 3</p>
        </header>

        {step === 1 && (
          <div className="onboarding__body">
            <label className="onboarding__field">
              <span className="onboarding__label">What is this Mind for?</span>
              <textarea
                className="onboarding__textarea"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                placeholder="e.g. Collecting references and arguments for our brand refresh. We're leaning toward something quieter and more typographic. Open question I'm chasing: what does 'serious without being corporate' look like in 2026?"
                rows={6}
                autoFocus
              />
              <span className="onboarding__hint">Optional, but the more specific the better.</span>
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding__body">
            <label className="onboarding__field">
              <span className="onboarding__label">Priming context for the assistant</span>
              <textarea
                className="onboarding__textarea"
                value={primer}
                onChange={(event) => setPrimer(event.target.value)}
                placeholder="e.g. I have a strong bias toward Swiss design and away from playful illustration. Take Pentagram and Wim Crouwel seriously; politely ignore most agency rebrand case studies."
                rows={6}
                autoFocus
              />
              <span className="onboarding__hint">
                Optional. Things you want the assistant to know about your stance, your sources, or what to ignore.
              </span>
            </label>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding__body">
            {isGenerating ? (
              <div className="thinking" aria-live="polite" aria-busy="true">
                <div className="thinking__head">
                  <span className="thinking__spinner" aria-hidden="true">{spinnerGlyph}</span>
                  <span className="thinking__label">Drafting</span>
                </div>
                <div className="thinking__phase" key={currentPhase}>
                  {currentPhase}
                  <span className="thinking__ellipsis" aria-hidden="true">…</span>
                </div>
                <div className="thinking__bar" aria-hidden="true" />
                <ul className="thinking__phases-list" aria-hidden="true">
                  {THINKING_PHASES.map((phase) => (
                    <li
                      key={phase}
                      className={`thinking__phases-item ${phase === currentPhase ? 'thinking__phases-item--active' : ''}`}
                    >
                      {phase}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <label className="onboarding__field">
                  <span className="onboarding__label">Generated system prompt</span>
                  <textarea
                    className="onboarding__textarea onboarding__textarea--prompt"
                    value={generatedPrompt}
                    onChange={(event) => setGeneratedPrompt(event.target.value)}
                    rows={16}
                  />
                  <span className="onboarding__hint">
                    Edit freely — you can change it later from the Mind settings.
                  </span>
                </label>
                <button type="button" className="link-button" onClick={generatePrompt}>
                  Regenerate
                </button>
              </>
            )}
          </div>
        )}

        {status ? <p className="onboarding__status">{status}</p> : null}

        <footer className="onboarding__footer">
          <div className="onboarding__footer-left">
            <Link href="/minds" className="link-button">
              Cancel
            </Link>
            {step > 1 && step < 3 ? (
              <button type="button" className="link-button" onClick={goBack}>
                Back
              </button>
            ) : null}
          </div>
          <div className="onboarding__footer-right">
            {step < 3 ? (
              <>
                <button type="button" className="button-secondary" onClick={openMindAndExit} disabled={isSaving}>
                  Skip — open Mind
                </button>
                <button type="button" className="button" onClick={goNext} disabled={isSaving}>
                  {step === 2 ? 'Generate prompt' : 'Next'}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="button-secondary" onClick={openMindAndExit} disabled={isSaving}>
                  Skip — open Mind
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={savePrompt}
                  disabled={isSaving || isGenerating || !generatedPrompt.trim()}
                >
                  {isSaving ? 'Saving…' : 'Save and open'}
                </button>
              </>
            )}
          </div>
        </footer>
      </section>
    </main>
  );
}

export default function TailorMindPage() {
  return (
    <AuthGate>
      <TailorMindContent />
    </AuthGate>
  );
}
