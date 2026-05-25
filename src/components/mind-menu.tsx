'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { MindSummary } from '@/lib/mind-context';

/**
 * The Mind name acts as a menu: jump back to all Minds, open this Mind's
 * settings, or switch to another Mind (preserving the current view/tab).
 * Replaces the old separate back-link + switcher dropdown + settings gear.
 */
export function MindMenu({
  id,
  name,
  minds,
  tab,
}: {
  id: string;
  name: string;
  minds: MindSummary[];
  tab: 'board' | 'map' | 'insights' | 'settings';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const suffix = tab === 'board' ? '' : `/${tab}`;
  const others = minds.filter((m) => m.id !== id);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="mind-menu" ref={ref}>
      <button
        type="button"
        className="mind-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {name || 'Mind'}
        <span className="mind-menu__caret" aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="mind-menu__pop" role="menu">
          <Link href="/minds" className="mind-menu__item" role="menuitem" onClick={() => setOpen(false)}>
            ← All Minds
          </Link>
          <Link
            href={`/minds/${id}/settings`}
            className="mind-menu__item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Mind settings
          </Link>

          {others.length ? (
            <>
              <div className="mind-menu__divider" />
              <p className="mind-menu__label">Switch to</p>
              {others.map((m) => (
                <Link
                  key={m.id}
                  href={`/minds/${m.id}${suffix}`}
                  className="mind-menu__item"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  {m.name}
                </Link>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
