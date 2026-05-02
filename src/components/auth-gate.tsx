'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/client-auth';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isAllowed, setIsAllowed] = useState(false);

  useEffect(() => {
    let isMounted = true;

    getSupabaseBrowser().auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      if (!data.session) {
        router.replace('/login');
        return;
      }
      setIsAllowed(true);
    });

    const {
      data: { subscription },
    } = getSupabaseBrowser().auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setIsAllowed(false);
        router.replace('/login');
      } else {
        setIsAllowed(true);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  if (!isAllowed) {
    return (
      <main className="app-shell">
        <section className="auth-check">
          <p className="eyebrow">Access check</p>
          <h1 className="page-title">Login required.</h1>
          <p className="lede">Redirecting to the secure MuttMind entrance.</p>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
