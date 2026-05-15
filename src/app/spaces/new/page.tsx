'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';

type Mind = {
  role: string;
  workspaces: {
    id: string;
    name: string;
    member_count?: number;
  };
};

type Step = 1 | 2 | 3 | 4;

function NewSpaceContent() {
  const router = useRouter();
  const [minds, setMinds] = useState<Mind[]>([]);
  const [mindId, setMindId] = useState('');
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [purpose, setPurpose] = useState('');
  const [primer, setPrimer] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState('');

  const loadMinds = useCallback(async () => {
    const response = await authedFetch('/api/workspaces');
    const data = await response.json();
    const nextMinds = data.workspaces ?? [];
    setMinds(nextMinds);
    setMindId((current) => {
      if (current) return current;
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem('muttmind:active-mind-id') : null;
      return stored ?? nextMinds[0]?.workspaces?.id ?? '';
    });
  }, []);

  useEffect(() => {
    loadMinds();
  }, [loadMinds]);

  const saveSpace = useCallback(
    async (systemPrompt?: string) => {
      if (!mindId) {
        setStatus('Choose a Mind first.');
        return;
      }
      const trimmedName = name.trim();
      const trimmedQuery = query.trim();
      if (!trimmedName || !trimmedQuery) {
        setStatus('Name and query are both required.');
        setStep(1);
        return;
      }

      setIsSaving(true);
      setStatus('Saving…');
      const body: Record<string, unknown> = {
        workspaceId: mindId,
        name: trimmedName,
        query: trimmedQuery,
        color: '#7c3aed',
      };
      if (systemPrompt && systemPrompt.trim()) {
        body.systemPrompt = systemPrompt.trim();
      }

      const response = await authedFetch('/api/spaces', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await response.json();
      setIsSaving(false);
      if (!response.ok) {
        setStatus(data.error ?? 'Unable to save Space.');
        return;
      }
      router.push('/spaces');
    },
    [mindId, name, query, router],
  );

  const generatePrompt = useCallback(async () => {
    if (!mindId || !name.trim()) return;
    setIsGenerating(true);
    setStatus('Generating a draft system prompt…');
    const response = await authedFetch('/api/spaces/generate-prompt', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: mindId,
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
  }, [mindId, name, purpose, primer]);

  const goNext = () => {
    setStatus('');
    if (step === 1) {
      if (!name.trim() || !query.trim()) {
        setStatus('Name and query are both required.');
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
    void saveSpace(undefined);
  };

  const finalize = () => {
    void saveSpace(generatedPrompt);
  };

  return (
    <main className="app-shell mind-shell">
      <AppNav active="spaces" />

      <section className="onboarding" aria-labelledby="new-space-title">
        <header className="onboarding__header">
          <p className="eyebrow">New Space</p>
          <h1 id="new-space-title" className="onboarding__title">
            {step === 1 && 'Name and what to filter for.'}
            {step === 2 && 'What is this Space for?'}
            {step === 3 && 'Anything to prime the assistant with?'}
            {step === 4 && 'Review the generated system prompt.'}
          </h1>
          <p className="onboarding__progress">Step {step} of 4</p>
        </header>

        {step === 1 && (
          <div className="onboarding__body">
            <label className="onboarding__field">
              <span className="onboarding__label">Mind</span>
              <select
                value={mindId}
                onChange={(event) => setMindId(event.target.value)}
                className="onboarding__input"
              >
                <option value="">Choose a Mind</option>
                {minds.map((mind) => (
                  <option key={mind.workspaces.id} value={mind.workspaces.id}>
                    {mind.workspaces.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="onboarding__field">
              <span className="onboarding__label">Space name</span>
              <input
                className="onboarding__input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="AI safety reading"
                autoFocus
              />
            </label>

            <label className="onboarding__field">
              <span className="onboarding__label">Filter</span>
              <input
                className="onboarding__input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="#ai-safety, type:article, by:pete, site:lesswrong.com"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') goNext();
                }}
              />
              <span className="onboarding__hint">
                A search like a tag (#tag), type (type:video), author (by:pete), or domain (site:example.com).
              </span>
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding__body">
            <label className="onboarding__field">
              <span className="onboarding__label">What is this Space for?</span>
              <textarea
                className="onboarding__textarea"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                placeholder="e.g. Tracking practical AI safety research I might draw from in essays. Lean toward technical alignment work over policy discussion. Open question I'm chasing: what does verifiable-by-default look like for agent systems?"
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
                placeholder="e.g. I tend to disagree with most foom-style framings. I take Christiano's writing seriously. I'm a practitioner, not an academic — examples and code over abstract claims."
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
                    This is what the assistant inside this Space will be told. Edit freely — you can also change it later.
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
            <Link href="/spaces" className="link-button">
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
                {step > 1 ? (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={skipToSave}
                    disabled={isSaving}
                  >
                    Skip & save
                  </button>
                ) : null}
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
                  {isSaving ? 'Saving…' : 'Create Space'}
                </button>
              </>
            )}
          </div>
        </footer>
      </section>
    </main>
  );
}

export default function NewSpacePage() {
  return (
    <AuthGate>
      <NewSpaceContent />
    </AuthGate>
  );
}
