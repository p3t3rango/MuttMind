'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';

function InviteContent() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [status, setStatus] = useState('Accept this invite to join the Shared Mind.');

  const acceptInvite = async () => {
    setStatus('Accepting invite...');
    const response = await authedFetch('/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token: params.token }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error ?? 'Unable to accept invite.');
      return;
    }
    setStatus('Invite accepted.');
    router.push('/dashboard');
  };

  return (
    <main className="app-shell mind-shell">
      <AppNav active="dashboard" />
      <section className="spaces-page" aria-labelledby="invite-title">
        <div className="spaces-page__header">
          <div>
            <p className="eyebrow">Shared Mind invite</p>
            <h1 id="invite-title">Join MuttMind</h1>
          </div>
          <div className="spaces-page__create">
            <p className="status">{status}</p>
            <button className="button" onClick={acceptInvite}>
              Accept Invite
            </button>
            <Link href="/login" className="button-secondary">
              Sign in first
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function InvitePage() {
  return (
    <AuthGate>
      <InviteContent />
    </AuthGate>
  );
}
