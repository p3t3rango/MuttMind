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
    <main className="app-shell home-shell">
      <AppNav active="home" />

      <section className="home" aria-labelledby="home-title">
        <header className="home__head">
          <p className="home__crumb">muttmind · a shared mind</p>
          <h1 id="home-title" className="home__title">
            Save links across the day. <br />
            Watch a Mind come together.
          </h1>
          <p className="home__lede">
            MuttMind turns the links your team shares into a curated body of work.
            Capture from Telegram or the browser; the assistant organizes,
            connects, and surfaces what would otherwise go to die in the chat.
          </p>
          <div className="home__actions">
            <Link href="/login" className="home__cta home__cta--primary">
              Sign in
            </Link>
            <a href="#how" className="home__cta home__cta--ghost">
              How it works
            </a>
          </div>
        </header>

        <ol className="home__steps" id="how">
          <li className="home__step">
            <p className="home__step-num">01</p>
            <div className="home__step-content">
              <h2 className="home__step-title">Capture</h2>
              <p className="home__step-body">
                Send a link from Telegram, paste it into the dashboard, or right-click an image. The capture lands in your active Mind with title, summary, og:image, and tags auto-filled.
              </p>
            </div>
          </li>
          <li className="home__step">
            <p className="home__step-num">02</p>
            <div className="home__step-content">
              <h2 className="home__step-title">Organize</h2>
              <p className="home__step-body">
                Each Mind is a focused container — one research project, topic, or interest. Solo by default; share to make it a Shared Mind. Each Mind has its own system prompt and voice.
              </p>
            </div>
          </li>
          <li className="home__step">
            <p className="home__step-num">03</p>
            <div className="home__step-content">
              <h2 className="home__step-title">Synthesize</h2>
              <p className="home__step-body">
                The assistant inside each Mind surfaces resonance across what you&apos;ve saved — relationships on a map, weekly digests via Telegram, on-demand essays from selected captures.
              </p>
            </div>
          </li>
        </ol>

        <footer className="home__foot">
          <p className="home__foot-line">
            Member-supported. No ads. <Link href="/login">Get started.</Link>
          </p>
        </footer>
      </section>
    </main>
  );
}
