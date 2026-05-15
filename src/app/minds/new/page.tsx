'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';

type Step = 1 | 2 | 3 | 4;

function NewMindContent() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [primer, setPrimer] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState('');

  const saveMind = useCallback(
    async (systemPrompt?: string) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        setStatus('Name is required.');
        setStep(1);
        return;
      }

      setIsSaving(true);
      setStatus('Saving…');
      const body: Record<string, unknown> = { name: trimmedName };
      if (systemPrompt && systemPrompt.trim()) {
        body.systemPrompt = systemPrompt.trim();
      }

      const response = await authedFetch('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await response.json();
      setIsSaving(false);
      if (!response.ok) {
        setStatus(data.error ?? 'Unable to create Mind.');
        return;
      }
      // Make the new Mind the active one when we land on the dashboard.
      if (data.workspace?.id) {
        window.localStorage.setItem('muttmind:active-mind-id', data.workspace.id);
      }
      router.push('/dashboard');
    },
    [name, router],
  );

  const generatePrompt = useCallback(async () => {
    if (!name.trim()) return;
    setIsGenerating(true);
    setStatus('Drafting a system prompt from your answers…');
    const response = await authedFetch('/api/workspaces/generate-prompt', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        purpose: purpose.trim() || undefined,
        primer: primer.trim() || undefined,
      }),
    });
    const data = await response.json();
    setIsGenerating(false);
    if (!response.ok) {
      setStatus(data.error ?? 'Unable to generate a prompt — you can write one yourself or skip.');
      setGeneratedPrompt('');
      return;
    }
    setGeneratedPrompt(data.systemPrompt ?? '');
    setStatus('');
  }, [name, purpose, primer]);

  const goNext = () => {
    setStatus('');
    if (step === 1) {
      if (!name.trim()) {
        setStatus('Name is required.');
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      setStep(3);
      return;
    }
    if (step === 3) {
      setStep(4);
      void generatePrompt();
      return;
    }
  };

  const goBack = () => {
    if (step === 1) return;
    setStep((step - 1) as Step);
  };

  const skipToSave = () => {
    void saveMind(undefined);
  };

  const finalize = () => {
    void saveMind(generatedPrompt);
  };

  return (
    <main className="app-shell mind-shell">
      <AppNav active="minds" />

      <section className="onboarding" aria-labelledby="new-mind-title">
        <header className="onboarding__header">
          <p className="eyebrow">New Mind</p>
          <h1 id="new-mind-title" className="onboarding__title">
            {step === 1 && 'Name your Mind.'}
            {step === 2 && 'What is this Mind for?'}
            {step === 3 && 'Anything to prime the assistant with?'}
            {step === 4 && 'Review the generated system prompt.'}
          </h1>
          <p className="onboarding__progress">Step {step} of 4</p>
        </header>

        {step === 1 && (
          <div className="onboarding__body">
            <label className="onboarding__field">
              <span className="onboarding__label">Mind name</span>
              <input
                className="onboarding__input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Q3 brand refresh research"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') goNext();
                }}
                autoFocus
              />
              <span className="onboarding__hint">
                A Mind is a focused container for one research project, topic, or interest. Solo by default; you can share it later from settings.
              </span>
            </label>
          </div>
        )}

        {step === 2 && (
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

        {step === 3 && (
          <div className="onboarding__body">
            <label className="onboarding__field">
              <span className="onboarding__label">Priming context for the assistant</span>
              <textarea
                className="onboarding__textarea"
                value={primer}
                onChange={(event) => setPrimer(event.target.value)}
                placeholder="e.g. I have a strong bias toward Swiss design and away from playful illustration. Take Pentagram and Wim Crouwel seriously; politely ignore most agency rebrand case studies. We're a small team, not a Fortune 500."
                rows={6}
                autoFocus
              />
              <span className="onboarding__hint">
                Optional. Things you want the assistant to know about your stance, your sources, or what to ignore.
              </span>
            </label>
          </div>
        )}

        {step === 4 && (
          <div className="onboarding__body">
            {isGenerating ? (
              <p className="onboarding__hint">Drafting a system prompt from your answers…</p>
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
                    This is what the assistant inside this Mind will be told. Edit freely — you can also change it later.
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
            {step > 1 && step < 4 ? (
              <button type="button" className="link-button" onClick={goBack}>
                Back
              </button>
            ) : null}
          </div>
          <div className="onboarding__footer-right">
            {step < 4 ? (
              <>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={skipToSave}
                  disabled={isSaving || !name.trim()}
                  title={!name.trim() ? 'Add a name first' : 'Save with default prompt'}
                >
                  Skip & save
                </button>
                <button type="button" className="button" onClick={goNext} disabled={isSaving}>
                  {step === 3 ? 'Generate prompt' : 'Next'}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="button-secondary" onClick={goBack} disabled={isSaving}>
                  Back
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={finalize}
                  disabled={isSaving || isGenerating || !generatedPrompt.trim()}
                >
                  {isSaving ? 'Saving…' : 'Create Mind'}
                </button>
              </>
            )}
          </div>
        </footer>
      </section>
    </main>
  );
}

export default function NewMindPage() {
  return (
    <AuthGate>
      <NewMindContent />
    </AuthGate>
  );
}
