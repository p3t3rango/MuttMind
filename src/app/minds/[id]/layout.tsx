'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { AskPanel } from '@/components/ask-panel';
import { Dropdown } from '@/components/dropdown';
import { MindProvider, type MindSummary } from '@/lib/mind-context';
import { authedFetch } from '@/lib/client-auth';

function ShellInner({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [minds, setMinds] = useState<MindSummary[]>([]);
  const [name, setName] = useState('');
  const [askOpen, setAskOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await authedFetch('/api/workspaces');
      const d = await r.json();
      const list: MindSummary[] = (d.workspaces ?? []).map(
        (row: { workspaces: { id: string; name: string } }) => ({
          id: row.workspaces.id,
          name: row.workspaces.name,
        }),
      );
      setMinds(list);
      setName(list.find((m) => m.id === id)?.name ?? '');
    })();
  }, [id]);

  useEffect(() => {
    if (id) window.localStorage.setItem('muttmind:active-mind-id', id);
  }, [id]);

  useEffect(() => {
    if (searchParams.get('ask') === '1') setAskOpen(true);
  }, [searchParams]);

  const tab: 'board' | 'map' | 'insights' = useMemo(() => {
    if (pathname.endsWith('/map')) return 'map';
    if (pathname.endsWith('/insights')) return 'insights';
    return 'board';
  }, [pathname]);

  const value = useMemo(() => ({ id, name, minds }), [id, name, minds]);

  return (
    <MindProvider value={value}>
      <main className="app-shell mind-shell">
        <AppNav active="minds" />

        <div className="mind-bar">
          <div className="mind-bar__lead">
            <Link href="/minds" className="mind-bar__back">‹ Minds</Link>
            <Dropdown
              value={id}
              options={minds.map((m) => ({ value: m.id, name: m.name }))}
              onChange={(next) => router.push(`/minds/${next}${tab === 'board' ? '' : `/${tab}`}`)}
              ariaLabel="Switch Mind"
              size="inline"
            />
          </div>

          <nav className="mind-tabs" aria-label="Mind views">
            <Link href={`/minds/${id}`} className={`mind-tab ${tab === 'board' ? 'mind-tab--on' : ''}`}>Board</Link>
            <Link href={`/minds/${id}/map`} className={`mind-tab ${tab === 'map' ? 'mind-tab--on' : ''}`}>Map</Link>
            <Link href={`/minds/${id}/insights`} className={`mind-tab ${tab === 'insights' ? 'mind-tab--on' : ''}`}>Insights</Link>
          </nav>

          <div className="mind-bar__actions">
            <Link href={`/minds/${id}/settings`} className="mind-bar__gear" aria-label="Mind settings">⚙</Link>
            <button type="button" className="ms-btn" onClick={() => setAskOpen(true)}>Ask ✦</button>
          </div>
        </div>

        {children}

        <AskPanel
          open={askOpen}
          onClose={() => setAskOpen(false)}
          workspaceId={id}
          mindName={name}
          onSaved={() => {}}
        />
      </main>
    </MindProvider>
  );
}

export default function MindLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <Suspense>
        <ShellInner>{children}</ShellInner>
      </Suspense>
    </AuthGate>
  );
}
