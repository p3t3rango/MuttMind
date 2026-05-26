# Cross-Mind Search — Implementation Plan (IA #2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-class cross-Mind search — `GET /api/search?q=` searches captures + insights across every Mind the user belongs to, and a `/search` page shows the results grouped by Mind, each linking into its item.

**Architecture:** A new `/api/search` route resolves the user's member workspaces server-side (never trusting a client id), then text-matches (`ilike`) `nodes` (title/summary/description/notes/raw_text/url) and `insights` (title/body) within those workspaces, plus tag matches via `tags`→`node_tags`. Pure helpers (`sanitizeSearchTerm`, `groupSearchResults`) are unit-tested. A `/search` page reads `?q`, fetches, and renders results grouped by Mind. The global `AppNav` box keeps its live per-surface `?q` filtering but now **submits (Enter) to `/search`** — so cross-Mind search is the box's primary job without breaking Board/Map/grid local filtering.

**Tech Stack:** Next.js App Router (client `/search` page, `useSearchParams`), Supabase admin client (`.in`, `.or`, `.ilike`), vitest for the pure helpers.

**Spec:** `docs/superpowers/specs/2026-05-23-mind-workspace-ia-design.md` (the "Cross-Mind search" section). v1 = text match (semantic ranking is a deferred fast-follow).

---

## File map
- **Create** `src/lib/search.ts` — pure helpers: `sanitizeSearchTerm()`, `groupSearchResults()`, shared result types.
- **Create** `src/lib/search.test.ts` — vitest for the helpers.
- **Create** `src/app/api/search/route.ts` — `GET /api/search?q=`, membership-scoped, returns grouped results.
- **Create** `src/app/search/page.tsx` — results page (reads `?q`, fetches, renders grouped by Mind).
- **Modify** `src/components/app-nav.tsx` — `NavSearch`: Enter submits to `/search?q=` (keep live `?q`).
- **Modify** `src/app/globals.css` — `.search-*` result styles.

Verification: vitest for helpers; build + lint + browser for route/page (repo pattern).

---

## Task 1: Search helpers (sanitizer + grouping) — TDD

**Files:** Create `src/lib/search.ts`, `src/lib/search.test.ts`.

- [ ] **Step 1: Failing tests** — create `src/lib/search.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sanitizeSearchTerm, groupSearchResults, type SearchCapture, type SearchInsight } from './search';

describe('sanitizeSearchTerm', () => {
  it('keeps words and spaces', () => {
    expect(sanitizeSearchTerm('  brand refresh ')).toBe('brand refresh');
  });
  it('strips PostgREST-breaking chars (, ( ) * % : .)', () => {
    expect(sanitizeSearchTerm('a,b(c)*d%e:f.g')).toBe('a b c d e f g');
  });
  it('collapses whitespace and returns empty for junk-only', () => {
    expect(sanitizeSearchTerm('   ')).toBe('');
    expect(sanitizeSearchTerm('(),.')).toBe('');
  });
});

describe('groupSearchResults', () => {
  const minds = new Map([['m1', 'Alpha'], ['m2', 'Beta']]);
  const caps: SearchCapture[] = [
    { id: 'c1', workspace_id: 'm1', title: 'A', kind: 'capture', url: null, summary: null },
    { id: 'c2', workspace_id: 'm2', title: 'B', kind: 'capture', url: null, summary: null },
  ];
  const ins: SearchInsight[] = [
    { id: 'i1', workspace_id: 'm1', title: 'I', kind: 'insight', snippet: 'x', source_kind: 'chat' },
  ];
  it('groups captures + insights by mind, with mind names, sorted by hit count desc', () => {
    const groups = groupSearchResults(caps, ins, minds);
    expect(groups.map((g) => g.mindId)).toEqual(['m1', 'm2']); // m1 has 2 hits, m2 has 1
    expect(groups[0]).toMatchObject({ mindId: 'm1', mindName: 'Alpha' });
    expect(groups[0].captures).toHaveLength(1);
    expect(groups[0].insights).toHaveLength(1);
    expect(groups[1].mindId).toBe('m2');
  });
  it('drops results whose mind is not in the membership map (no leakage)', () => {
    const stray: SearchCapture[] = [{ id: 'x', workspace_id: 'm9', title: 'X', kind: 'capture', url: null, summary: null }];
    expect(groupSearchResults(stray, [], minds)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run `npm run test` → FAIL** (module not found).

- [ ] **Step 3: Implement `src/lib/search.ts`:**

```ts
export type SearchCapture = {
  id: string;
  workspace_id: string;
  title: string | null;
  kind: 'capture';
  url: string | null;
  summary: string | null;
};

export type SearchInsight = {
  id: string;
  workspace_id: string;
  title: string | null;
  kind: 'insight';
  snippet: string;
  source_kind: string | null;
};

export type SearchGroup = {
  mindId: string;
  mindName: string;
  captures: SearchCapture[];
  insights: SearchInsight[];
};

/**
 * Make a raw query safe for a PostgREST `.or(...)` ilike filter: strip the
 * characters that have meaning in that mini-grammar ( , ( ) * % : . ) so user
 * input can't break or inject into the filter string. Collapse whitespace.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()*%:.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Group captures + insights by Mind. Drops any whose mind isn't in `minds`
 *  (membership guard). Sorts groups by total hit count desc, then mind name. */
export function groupSearchResults(
  captures: SearchCapture[],
  insights: SearchInsight[],
  minds: Map<string, string>,
): SearchGroup[] {
  const byId = new Map<string, SearchGroup>();
  const ensure = (wsId: string): SearchGroup | null => {
    const name = minds.get(wsId);
    if (name === undefined) return null; // not a member — never surface
    let g = byId.get(wsId);
    if (!g) {
      g = { mindId: wsId, mindName: name, captures: [], insights: [] };
      byId.set(wsId, g);
    }
    return g;
  };
  for (const c of captures) ensure(c.workspace_id)?.captures.push(c);
  for (const i of insights) ensure(i.workspace_id)?.insights.push(i);
  return [...byId.values()].sort((a, b) => {
    const diff = b.captures.length + b.insights.length - (a.captures.length + a.insights.length);
    return diff !== 0 ? diff : a.mindName.localeCompare(b.mindName);
  });
}
```

- [ ] **Step 4: `npm run test` → PASS** (all green). **Step 5: Commit:**
```bash
git add src/lib/search.ts src/lib/search.test.ts
git commit -m "feat(search): cross-Mind search helpers (sanitize + group) with tests"
```

---

## Task 2: `/api/search` route

**Files:** Create `src/app/api/search/route.ts`.

- [ ] **Step 1: Write the route:**

```ts
import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { groupSearchResults, sanitizeSearchTerm, type SearchCapture, type SearchInsight } from '@/lib/search';

const LIMIT = 60;

/**
 * GET /api/search?q=...
 * Searches captures + insights across every Mind the user belongs to (resolved
 * server-side from workspace_members — never a client-supplied id), text-match
 * only (v1). Returns results grouped by Mind.
 */
export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const raw = new URL(req.url).searchParams.get('q') ?? '';
    const term = sanitizeSearchTerm(raw);
    if (!term) return Response.json({ groups: [] });

    const db = getSupabaseAdmin();

    // Member Minds (id -> name). This is the only authorization gate.
    const { data: memberRows, error: mErr } = await db
      .from('workspace_members')
      .select('workspace_id, workspaces(id,name)')
      .eq('user_id', userId);
    if (mErr) return Response.json({ error: mErr.message }, { status: 500 });
    const minds = new Map<string, string>();
    for (const row of (memberRows ?? []) as { workspaces: { id: string; name: string } | null }[]) {
      if (row.workspaces) minds.set(row.workspaces.id, row.workspaces.name);
    }
    const ids = [...minds.keys()];
    if (!ids.length) return Response.json({ groups: [] });

    const like = `*${term}*`;
    const nodeOr = [
      `title.ilike.${like}`,
      `ai_summary.ilike.${like}`,
      `source_description.ilike.${like}`,
      `user_notes.ilike.${like}`,
      `raw_text.ilike.${like}`,
      `original_url.ilike.${like}`,
    ].join(',');

    const { data: nodeRows, error: nErr } = await db
      .from('nodes')
      .select('id,workspace_id,title,original_url,ai_summary')
      .in('workspace_id', ids)
      .or(nodeOr)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    if (nErr) return Response.json({ error: nErr.message }, { status: 500 });

    const { data: insightRows, error: iErr } = await db
      .from('insights')
      .select('id,workspace_id,title,body,source_kind')
      .in('workspace_id', ids)
      .or(`title.ilike.${like},body.ilike.${like}`)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    if (iErr) return Response.json({ error: iErr.message }, { status: 500 });

    const captures: SearchCapture[] = (nodeRows ?? []).map((n) => ({
      id: n.id as string,
      workspace_id: n.workspace_id as string,
      title: (n.title ?? null) as string | null,
      kind: 'capture',
      url: (n.original_url ?? null) as string | null,
      summary: (n.ai_summary ?? null) as string | null,
    }));
    const insights: SearchInsight[] = (insightRows ?? []).map((i) => {
      const body = (i.body ?? '') as string;
      return {
        id: i.id as string,
        workspace_id: i.workspace_id as string,
        title: (i.title ?? null) as string | null,
        kind: 'insight',
        snippet: body.length > 160 ? `${body.slice(0, 160).trim()}…` : body,
        source_kind: (i.source_kind ?? null) as string | null,
      };
    });

    return Response.json({ groups: groupSearchResults(captures, insights, minds) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
```

> **Tag search is deferred to a fast-follow** (it needs `tags`→`node_tags`→`nodes` joins; v1 covers node text + insights, which is the bulk of findability and matches the confirmed "text-match first" scope). Note this in the commit.

- [ ] **Step 2:** `npm run lint && npm run build` → clean; `/api/search` present.
- [ ] **Step 3: Commit:**
```bash
git add src/app/api/search/route.ts
git commit -m "feat(search): /api/search — membership-scoped cross-Mind text search (tags deferred)"
```

---

## Task 3: `/search` results page

**Files:** Create `src/app/search/page.tsx`.

- [ ] **Step 1: Write the page** (reads `?q`, fetches, renders grouped; captures deep-link into the Board via the existing `muttmind:focus-capture-id` mechanism; insights link to the Mind's Insights):

```tsx
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';
import type { SearchGroup } from '@/lib/search';

function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get('q') ?? '';
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setGroups([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const r = await authedFetch(`/api/search?q=${encodeURIComponent(term)}`);
      const d = await r.json();
      if (!cancelled) {
        setGroups(r.ok ? (d.groups ?? []) : []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q]);

  const openCapture = (mindId: string, captureId: string) => {
    window.localStorage.setItem('muttmind:focus-capture-id', captureId);
    router.push(`/minds/${mindId}`);
  };

  const total = groups.reduce((n, g) => n + g.captures.length + g.insights.length, 0);

  return (
    <main className="app-shell">
      <AppNav active="minds" />
      <section className="search-page">
        <p className="search-page__crumb">
          {q.trim()
            ? loading
              ? 'Searching all Minds…'
              : `${total} result${total === 1 ? '' : 's'} for “${q.trim()}” across your Minds`
            : 'Type to search across all your Minds.'}
        </p>

        {!loading && q.trim() && total === 0 ? (
          <p className="search-page__empty">Nothing matched. Try a different term.</p>
        ) : null}

        {groups.map((g) => (
          <section key={g.mindId} className="search-group">
            <div className="search-group__head">
              <Link href={`/minds/${g.mindId}`} className="search-group__mind">{g.mindName}</Link>
              <span className="search-group__count">
                {g.captures.length + g.insights.length}
              </span>
            </div>
            <ul className="search-list" role="list">
              {g.captures.map((c) => (
                <li key={c.id}>
                  <button type="button" className="search-hit" onClick={() => openCapture(g.mindId, c.id)}>
                    <span className="search-hit__kind">capture</span>
                    <span className="search-hit__title">{c.title ?? c.url ?? 'Untitled'}</span>
                    {c.summary ? <span className="search-hit__sub">{c.summary.slice(0, 120)}</span> : null}
                  </button>
                </li>
              ))}
              {g.insights.map((i) => (
                <li key={i.id}>
                  <Link href={`/minds/${g.mindId}/insights`} className="search-hit">
                    <span className="search-hit__kind">insight</span>
                    <span className="search-hit__title">{i.title ?? 'Insight'}</span>
                    <span className="search-hit__sub">{i.snippet}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
    </main>
  );
}

export default function SearchPage() {
  return (
    <AuthGate>
      <Suspense>
        <SearchResults />
      </Suspense>
    </AuthGate>
  );
}
```

- [ ] **Step 2:** `npm run lint && npm run build` → clean; `/search` builds.
- [ ] **Step 3: Commit:**
```bash
git add src/app/search/page.tsx
git commit -m "feat(search): /search results page grouped by Mind"
```

---

## Task 4: Global search box submits to /search

**Files:** Modify `src/components/app-nav.tsx` (`NavSearch`).

- [ ] **Step 1:** Keep the existing live `?q` update (`updateSearch`). Wrap the search `<input>` in a `<form>` (or add `onKeyDown`) so **Enter** routes to the cross-Mind results page. Add to `NavSearch`: `const router = useRouter();` is already imported there. Change the `<label className="nav-search">` to a `<form>` with `onSubmit`:

```tsx
  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const term = searchQuery.trim();
    if (term) router.push(`/search?q=${encodeURIComponent(term)}`);
  };
```

Wrap the existing search markup:
```tsx
    <form className="nav-search" onSubmit={submitSearch} role="search">
      <span className="sr-only">Search MuttMind</span>
      <span className="nav-search__icon" aria-hidden="true">⌕</span>
      <input
        ref={searchInputRef}
        type="search"
        className="nav-search__input"
        placeholder="Search all Minds"
        value={searchQuery}
        onChange={(e) => updateSearch(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {!searchQuery ? <span className="nav-search__hint" aria-hidden="true">⌘K</span> : null}
    </form>
```
(Was a `<label>`; `<form>` submit on Enter triggers `submitSearch`. Keep `updateSearch` so per-surface `?q` filtering still works as you type. Update the placeholder to "Search all Minds" to signal cross-Mind.)

- [ ] **Step 2:** `npm run lint && npm run build` → clean.
- [ ] **Step 3: Commit:**
```bash
git add src/components/app-nav.tsx
git commit -m "feat(search): global box submits to cross-Mind /search (keeps live local filter)"
```

---

## Task 5: Styles + full build + e2e

**Files:** Modify `src/app/globals.css`.

- [ ] **Step 1: Append result styles** (dark/mono shell):

```css
.search-page { padding: clamp(28px, 4vw, 48px) clamp(20px, 4vw, 56px) 64px; }
.search-page__crumb { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.04em; color: rgba(247,247,242,0.5); margin: 0 0 24px; }
.search-page__empty { color: rgba(247,247,242,0.6); }
.search-group { margin-bottom: 28px; }
.search-group__head { display: flex; align-items: baseline; gap: 10px; border-bottom: 1px solid rgba(247,247,242,0.1); padding-bottom: 8px; margin-bottom: 10px; }
.search-group__mind { font-size: 15px; color: var(--ink); text-decoration: none; }
.search-group__mind:hover { text-decoration: underline; }
.search-group__count { font-family: var(--font-mono); font-size: 11px; color: rgba(247,247,242,0.4); }
.search-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.search-hit { display: grid; grid-template-columns: 70px 1fr; gap: 4px 12px; width: 100%; text-align: left; background: none; border: none; border-bottom: 1px solid rgba(247,247,242,0.06); padding: 10px 0; cursor: pointer; text-decoration: none; align-items: baseline; }
.search-hit:hover { background: rgba(247,247,242,0.04); }
.search-hit__kind { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(247,247,242,0.4); }
.search-hit__title { color: var(--ink); font-size: 14px; }
.search-hit__sub { grid-column: 2; color: rgba(247,247,242,0.5); font-size: 12px; }
```

- [ ] **Step 2: Full build:** `npm run build` → succeeds; routes include `/api/search` and `/search`. `npm run test` → all pass (incl. the Task 1 helpers).
- [ ] **Step 3: Browser e2e** (`npm run dev`):
  1. With ≥2 Minds that have captures/insights, type a term in the top bar and press **Enter** → lands on `/search` with results grouped by Mind.
  2. Only your Minds appear (no other users' content).
  3. A **capture** hit opens that Mind's Board with the capture drawer focused; an **insight** hit opens that Mind's Insights.
  4. Empty/no-match term shows the empty state.
  5. Typing on the Board still live-filters captures (local `?q` preserved); Enter still goes cross-Mind.
- [ ] **Step 4: Commit:**
```bash
git add src/app/globals.css
git commit -m "feat(search): cross-Mind results styles; finalize search"
```

---

## Self-review notes
- **Spec coverage:** `/api/search` membership-scoped server-side (Task 2, no client id — list-then-filter via workspace_members), captures + insights text search (Task 2), results grouped by Mind linking into items (Task 3), global box is the entry (Task 4), per-surface contextual search preserved (Task 4 keeps live `?q`). ✓
- **Deferred (noted):** tag search (`tags`→`node_tags`) and semantic ranking — both fast-follows per the spec's "text-match first."
- **Security:** `sanitizeSearchTerm` strips PostgREST `.or` metacharacters (unit-tested) so user input can't break/inject the filter; membership is the only gate and is resolved server-side; `groupSearchResults` drops any row whose mind isn't in the membership map (defense-in-depth, unit-tested).
- **Type consistency:** `SearchCapture`/`SearchInsight`/`SearchGroup` defined in `src/lib/search.ts`, consumed by the route and the page; `kind` discriminant `'capture'|'insight'`.
```
