'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '@/components/app-nav';
import { getSupabaseBrowser } from '@/lib/client-auth';

export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    getSupabaseBrowser().auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        router.replace('/dashboard');
        return;
      }
      setReady(true);
    });

    return () => {
      mounted = false;
    };
  }, [router]);

  if (!ready) {
    return null;
  }

  return (
    <main className="app-shell">
      <AppNav active="home" />

      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <div className="hero-content">
            <p className="eyebrow">§ Public index / MuttMind brief</p>
            <h1 id="home-title" className="display-title">Capture the links your team keeps revisiting.</h1>
            <p className="lede">
              MuttMind turns links, notes, and source context into a shared workspace
              vault. Capture from Telegram or the browser, group by workspace, and review
              the graph when you need the shape of the work.
            </p>
            <div className="hero-actions">
              <Link href="/login" className="button">
                Sign In
              </Link>
              <a href="#how-it-works" className="button-secondary">
                How It Works
              </a>
            </div>
          </div>
        </div>

        <div className="workspace">
          <div className="panel">
            <p className="kicker">WHAT YOU GET</p>
            <h2>A working memory for your team.</h2>
            <div className="settings-list">
              <div className="list-item">
                <span className="metric-value">CAPTURE</span>
                <span className="metric-label">Save URLs, notes, and source context in one place.</span>
              </div>
              <div className="list-item">
                <span className="metric-value">ORGANIZE</span>
                <span className="metric-label">Group signals by workspace and framework tags.</span>
              </div>
              <div className="list-item">
                <span className="metric-value">REVIEW</span>
                <span className="metric-label">Inspect thumbnails, list views, and the vault graph.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="surface-grid" id="how-it-works" aria-label="How MuttMind works">
        <article className="panel">
          <p className="eyebrow">01 Capture</p>
          <h3>Send a link, keep the context.</h3>
          <p className="lede">
            Telegram and the browser feed the same vault, so the signal, the note, and the
            source all land together.
          </p>
        </article>
        <article className="panel">
          <p className="eyebrow">02 Organize</p>
          <h3>Work by workspace.</h3>
          <p className="lede">
            Each team or project gets its own vault scope, tags, and capture history.
          </p>
        </article>
        <article className="panel">
          <p className="eyebrow">03 Review</p>
          <h3>See the shape of the work.</h3>
          <p className="lede">
            Use the list view for scanning and the graph view for relationships between
            captured items.
          </p>
        </article>
      </section>
    </main>
  );
}
