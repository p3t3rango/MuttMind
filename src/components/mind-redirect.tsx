'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';

/** Resolves the last-active (or first) Mind and redirects to that Mind's view. */
export function MindRedirect({ view }: { view: '' | 'map' }) {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      let id = window.localStorage.getItem('muttmind:active-mind-id') ?? '';
      if (!id) {
        const r = await authedFetch('/api/workspaces');
        const d = await r.json();
        id = d.workspaces?.[0]?.workspaces?.id ?? '';
      }
      router.replace(id ? `/minds/${id}${view ? `/${view}` : ''}` : '/minds');
    })();
  }, [router, view]);
  return <p className="dash-loading">Taking you to your Mind…</p>;
}

export function MindRedirectPage({ view }: { view: '' | 'map' }) {
  return <AuthGate><MindRedirect view={view} /></AuthGate>;
}
