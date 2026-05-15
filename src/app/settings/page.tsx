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
