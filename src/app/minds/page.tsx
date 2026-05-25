'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ActivationChecklist } from '@/components/activation-checklist';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { NewMindModal } from '@/components/new-mind-modal';
import { authedFetch } from '@/lib/client-auth';

type RecentCapture = {
  id: string;
  title: string | null;
  original_url: string | null;
  og_image_url: string | null;
  created_at: string;
};

type Mind = {
  role: string;
  workspaces: {
    id: string;
    name: string;
    description: string | null;
    privacy: string;
    member_count?: number;
    capture_count?: number;
    recent_captures?: RecentCapture[];
    created_at: string;
  };
};

function relativeTime(iso?: string) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = (Date.now() - then) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

function getMindLabel(mind: Mind | undefined) {
  if (!mind) return 'Mind';
  return (mind.workspaces.member_count ?? 1) > 1 ? 'Shared Mind' : 'Mind';
}

function MindsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = (searchParams.get('q') ?? '').trim().toLowerCase();
  const [minds, setMinds] = useState<Mind[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const telegramBotUrl = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL ?? '';
  const openTelegramBot = useCallback(async () => {
    const popup = window.open('', '_blank');
    if (popup) popup.opener = null;
    const response = await authedFetch('/api/telegram-link', { method: 'POST' });
    const data = await response.json();
    const targetUrl = response.ok && data.url ? data.url : telegramBotUrl;
    if (!targetUrl) {
      popup?.close();
      return;
    }
    if (popup) {
      popup.location.href = targetUrl;
    } else {
      window.location.href = targetUrl;
    }
  }, [telegramBotUrl]);

  const loadMinds = useCallback(async () => {
    try {
      const response = await authedFetch('/api/workspaces?include=recent');
      const data = await response.json();
      setMinds((data.workspaces ?? []) as Mind[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMinds();
  }, [loadMinds]);

  const visibleMinds = useMemo(() => {
    if (!query) return minds;
    return minds.filter((mind) => {
      const w = mind.workspaces;
      const haystack = [w.name, w.description ?? ''].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [minds, query]);

  const openMind = (mind: Mind) => {
    window.localStorage.setItem('muttmind:active-mind-id', mind.workspaces.id);
    router.push('/dashboard');
  };

  const openCapture = (mindId: string) => {
    // For now, opening any capture lands the user on the Mind's dashboard.
    // A future hop could deep-link directly to the drawer for that capture id.
    window.localStorage.setItem('muttmind:active-mind-id', mindId);
    router.push('/dashboard');
  };

  return (
    <main className="app-shell mind-shell">
      <AppNav active="minds" />

      <section className="minds-page">
        <header className="minds-page__top">
          <div className="minds-page__crumb">
            <span>you</span>
            <span className="minds-page__crumb-sep">/</span>
            <span>
              {loading
                ? '…'
                : query
                  ? `${visibleMinds.length} of ${minds.length} ${minds.length === 1 ? 'mind' : 'minds'}`
                  : `${minds.length} ${minds.length === 1 ? 'mind' : 'minds'}`}
            </span>
          </div>
          <button type="button" className="minds-page__new" onClick={() => setModalOpen(true)}>
            New Mind <span aria-hidden="true">+</span>
          </button>
        </header>

        <nav className="minds-page__pivots" aria-label="View">
          <span className="minds-page__pivot minds-page__pivot--active">Minds</span>
          <Link href="/dashboard" className="minds-page__pivot">Dashboard</Link>
          <Link href="/vault" className="minds-page__pivot">Map</Link>
        </nav>

        {loading ? (
          <p className="minds-empty__hint" style={{ paddingTop: 24, opacity: 0.35 }}>
            Loading your Minds…
          </p>
        ) : minds.length ? (
          <ul className="minds-list" role="list">
            {visibleMinds.map((mind) => {
              const w = mind.workspaces;
              const captures = w.recent_captures ?? [];
              const filledSlots: (RecentCapture | null)[] = [
                captures[0] ?? null,
                captures[1] ?? null,
                captures[2] ?? null,
                captures[3] ?? null,
              ];
              return (
                <li key={w.id} className="mind-row">
                  <div className="mind-row__lead">
                    <button type="button" className="mind-row__main" onClick={() => openMind(mind)}>
                      <span className="mind-row__name">{w.name}</span>
                      <span className="mind-row__meta">
                        {w.capture_count ?? 0} {w.capture_count === 1 ? 'capture' : 'captures'} · {getMindLabel(mind)} · {w.privacy}
                        {w.created_at ? ` · ${relativeTime(w.created_at)}` : ''}
                      </span>
                      {w.description ? <span className="mind-row__desc">{w.description}</span> : null}
                    </button>
                    <Link
                      href={`/minds/${w.id}/settings`}
                      className="mind-row__settings"
                      aria-label={`Settings for ${w.name}`}
                    >
                      Settings
                    </Link>
                  </div>
                  <div className="mind-row__strip" aria-label="Recent captures">
                    {filledSlots.map((cap, idx) =>
                      cap ? (
                        <button
                          key={cap.id}
                          type="button"
                          className="mind-row__thumb"
                          onClick={() => openCapture(w.id)}
                          aria-label={cap.title ?? 'Open capture'}
                        >
                          {cap.og_image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={cap.og_image_url} alt="" />
                          ) : (
                            <span className="mind-row__thumb-fallback">
                              {cap.title ?? '◌'}
                            </span>
                          )}
                        </button>
                      ) : (
                        <button
                          key={`empty-${idx}`}
                          type="button"
                          className="mind-row__thumb mind-row__thumb--empty"
                          onClick={() => openMind(mind)}
                          aria-label="Add captures to this Mind"
                        >
                          {idx === 0 && captures.length === 0 ? <span>+</span> : null}
                        </button>
                      ),
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="minds-empty">
            <p className="minds-empty__hint">You have no Minds yet.</p>
            <button type="button" className="button" onClick={() => setModalOpen(true)}>
              + New Mind
            </button>
          </div>
        )}
      </section>

      <NewMindModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => loadMinds()}
      />

      <ActivationChecklist
        milestones={[
          {
            key: 'mind',
            label: 'Create your first Mind',
            done: minds.length > 0,
          },
          {
            key: 'capture',
            label: 'Save your first capture',
            done: minds.some((m) => (m.workspaces.capture_count ?? 0) > 0),
          },
          {
            key: 'tailor',
            label: 'Tailor your assistant',
            done: false,
            manuallyCheckable: true,
            onAction: () => {
              const firstId = minds[0]?.workspaces.id;
              if (firstId) router.push(`/minds/${firstId}/settings`);
            },
          },
          {
            key: 'shared',
            label: 'Make it a Shared Mind',
            done: minds.some((m) => (m.workspaces.member_count ?? 1) > 1),
            onAction: () => setModalOpen(true),
          },
          {
            key: 'telegram',
            label: 'Connect the Telegram bot',
            done: false,
            manuallyCheckable: true,
            onAction: openTelegramBot,
          },
        ]}
      />
    </main>
  );
}

export default function MindsPage() {
  return (
    <AuthGate>
      <MindsContent />
    </AuthGate>
  );
}
