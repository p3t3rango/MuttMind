'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';

type ConnectState = {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  message: string;
  accountLabel: string;
  botUrl: string;
};

function TelegramConnectContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<ConnectState>({
    status: 'idle',
    message: 'Ready to connect this Telegram chat.',
    accountLabel: '',
    botUrl: '',
  });

  const connectTelegram = useCallback(async () => {
    if (!token) {
      setState((current) => ({
        ...current,
        status: 'error',
        message: 'Missing Telegram connect token. Return to Telegram and send /start again.',
      }));
      return;
    }

    setState((current) => ({ ...current, status: 'connecting', message: 'Connecting Telegram...' }));
    const response = await authedFetch('/api/telegram-connect', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    const data = await response.json();

    if (!response.ok) {
      setState((current) => ({
        ...current,
        status: 'error',
        message: data.error ?? 'Unable to connect Telegram.',
      }));
      return;
    }

    const accountLabel = data.user?.display_name || data.user?.email || 'your MuttMind account';
    setState({
      status: 'connected',
      message: 'Telegram is connected. I sent a confirmation inside the bot.',
      accountLabel,
      botUrl: data.botUrl ?? '',
    });
  }, [token]);

  useEffect(() => {
    connectTelegram();
  }, [connectTelegram]);

  return (
    <main className="app-shell mind-shell">
      <AppNav active="dashboard" />
      <section className="telegram-connect" aria-labelledby="telegram-connect-title">
        <div>
          <p className="eyebrow">Telegram connection</p>
          <h1 id="telegram-connect-title">Connect MuttMindBot.</h1>
          <p className="lede">
            This links the Telegram chat you started from to the MuttMind account currently signed in here.
          </p>
        </div>

        <div className="panel telegram-connect__panel">
          <p className="kicker">{state.status === 'connected' ? 'Connected account' : 'Connection status'}</p>
          <h2>{state.status === 'connected' ? state.accountLabel : state.message}</h2>
          {state.status === 'connected' ? <p className="meta">{state.message}</p> : null}
          {state.status === 'error' ? (
            <button className="button" type="button" onClick={connectTelegram}>
              Try Again
            </button>
          ) : null}
          {state.botUrl ? (
            <a className="button" href={state.botUrl}>
              Return to Telegram
            </a>
          ) : null}
          <Link href="/dashboard" className="button-secondary">
            Back to Mind
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function TelegramConnectPage() {
  return (
    <AuthGate>
      <TelegramConnectContent />
    </AuthGate>
  );
}
