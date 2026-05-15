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
            <p className="eyebrow">§ MuttMind brief</p>
            <h1 id="home-title" className="display-title">Capture the links your team keeps revisiting.</h1>
            <p className="lede">
              MuttMind turns links, notes, and source context into a shared Mind.
              Capture from Telegram or the browser, let AI organize it, then watch
              connections surface across what your team has saved.
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
                <span className="metric-label">Group captures by Mind, uploader, type, and tags.</span>
              </div>
              <div className="list-item">
                <span className="metric-value">REVIEW</span>
                <span className="metric-label">Inspect thumbnails, the relationship map, and synthesis essays.</span>
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
            Telegram and the browser feed the same Mind, so the signal, the note, and the
            source all land together.
          </p>
        </article>
        <article className="panel">
          <p className="eyebrow">02 Organize</p>
          <h3>Work by Mind.</h3>
          <p className="lede">
            Each personal or shared Mind gets its own tags, members, system prompt, and capture history.
          </p>
        </article>
        <article className="panel">
          <p className="eyebrow">03 Review</p>
          <h3>See the shape of the work.</h3>
          <p className="lede">
            Use the main Mind view for scanning and the map for relationships between
            captured items.
          </p>
        </article>
      </section>
    </main>
  );
}
