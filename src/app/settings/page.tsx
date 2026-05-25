'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';

type Mind = {
  role: string;
  workspaces: { id: string; name: string; member_count?: number };
};

function SettingsContent() {
  const [minds, setMinds] = useState<Mind[]>([]);
  const [telegramStatus, setTelegramStatus] = useState('');

  const telegramBotUrl = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL ?? '';
  const openTelegramBot = useCallback(async () => {
    const popup = window.open('', '_blank');
    if (popup) popup.opener = null;

    setTelegramStatus('Opening Telegram bot…');
    const response = await authedFetch('/api/telegram-link', { method: 'POST' });
    const data = await response.json();
    const targetUrl = response.ok && data.url ? data.url : telegramBotUrl;

    if (!targetUrl) {
      popup?.close();
      setTelegramStatus(data.error ?? 'Telegram bot URL is not configured.');
      return;
    }

    if (popup) {
      popup.location.href = targetUrl;
    } else {
      window.location.href = targetUrl;
    }

    setTelegramStatus(
      response.ok
        ? 'Telegram opened. Press Start in the bot to link this account.'
        : `Telegram opened, but account linking needs attention: ${data.error ?? 'missing link token'}`,
    );
  }, [telegramBotUrl]);

  const loadMinds = useCallback(async () => {
    const r = await authedFetch('/api/workspaces');
    const d = await r.json();
    setMinds((d.workspaces ?? []) as Mind[]);
  }, []);

  useEffect(() => {
    loadMinds();
  }, [loadMinds]);

  return (
    <main className="app-shell ms-shell">
      <AppNav active="settings" />

      <section className="ms-page">
        <header className="ms-top">
          <div className="ms-crumb">
            <span>settings</span>
            <span className="ms-crumb__sep">/</span>
            <span className="ms-crumb__current">choose a Mind</span>
          </div>
        </header>

        <p className="ms-section__hint" style={{ marginBottom: 8 }}>
          Settings are scoped per Mind. Pick one to configure its assistant, members, tags, and privacy.
        </p>

        <div className="ms-members">
          {minds.map((m) => (
            <Link key={m.workspaces.id} href={`/minds/${m.workspaces.id}/settings`} className="ms-pick">
              <span className="ms-pick__name">{m.workspaces.name}</span>
              <span className="ms-pick__meta">
                {(m.workspaces.member_count ?? 1) > 1 ? 'Shared Mind' : 'Mind'} · {m.role} →
              </span>
            </Link>
          ))}
          {minds.length === 0 ? <p className="tag-table__empty">No Minds yet.</p> : null}
        </div>

        <div className="ms-section" style={{ marginTop: 32 }}>
          <h2 className="ms-section__title">Connections</h2>
          <p className="ms-section__hint">
            Connect Telegram to save captures from anywhere — just send a link or voice memo to the bot.
          </p>
          <button type="button" className="button-secondary" onClick={openTelegramBot}>
            Connect Telegram
          </button>
          {telegramStatus ? (
            <p className="ms-section__hint" aria-live="polite" style={{ marginTop: 8 }}>
              {telegramStatus}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsContent />
    </AuthGate>
  );
}
