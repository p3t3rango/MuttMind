# Mind Workspace Shell + Nav Migration — Implementation Plan (IA #1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Mind the unit of navigation — one nav, a shared `MindShell` with Board/Map/Insights tabs and an omnipresent Ask overlay, the active Mind read from the URL, and every legacy route redirected.

**Architecture:** Add `src/app/minds/[id]/layout.tsx` (`MindShell`) that wraps all Mind views: it loads the Mind, renders the global top bar + a Mind sub-header (name + switcher + settings gear + Board/Map/Insights tabs + Ask ✦), mounts `AskPanel` once, and writes "last-active Mind". The three views become route children: **Board** = today's dashboard moved to `/minds/[id]` and scoped to the route id (no dropdown); **Map** = `/vault` moved to `/minds/[id]/map`; **Insights** = `/minds/[id]/essays` renamed to `/minds/[id]/insights` (its own nav/Ask removed — the shell provides them). The old `dash-pivots`, the standalone Ask page + `/api/ask`, and Tailor all retire. `AppNav` slims to brand + search + account. Stub `/dashboard`, `/vault`, `/minds/[id]/essays|ask|tailor`, and authed `/` as redirects.

**Tech Stack:** Next.js App Router (client components, `layout.tsx`, `useParams`/`usePathname`/`redirect`), Supabase via `authedFetch`, existing `AppNav`/`AuthGate`/`AskPanel`.

**Spec:** `docs/superpowers/specs/2026-05-23-mind-workspace-ia-design.md`

**Scope note:** This is IA plan #1 of 3. Cross-Mind search (#2) and multi-scope Ask (#3) are separate plans. Here the top-bar search keeps its current behavior (updates `?q` on the active view); it becomes cross-Mind in #2.

---

## File map

- **Create** `src/app/minds/[id]/layout.tsx` — `MindShell`: auth + Mind load + sub-header (switcher, gear, tabs, Ask) + `AskPanel` mount + last-active write + `MindContext` provider.
- **Create** `src/lib/mind-context.tsx` — `MindContext` + `useMind()` hook ({ id, name, minds }).
- **Create** `src/app/minds/[id]/page.tsx` — **Board** (moved from `dashboard/page.tsx`, route-scoped).
- **Create** `src/app/minds/[id]/map/page.tsx` — **Map** (moved from `vault/page.tsx`, route-scoped).
- **Rename** `src/app/minds/[id]/essays/page.tsx` → `src/app/minds/[id]/insights/page.tsx` — **Insights** (shell provides nav/Ask).
- **Modify** `src/app/minds/[id]/settings/page.tsx` — fold in Tailor; drop own `AppNav`/`AuthGate` (shell wraps).
- **Replace with redirects**: `src/app/dashboard/page.tsx`, `src/app/vault/page.tsx`, `src/app/minds/[id]/essays/page.tsx`, `src/app/minds/[id]/ask/page.tsx`, `src/app/minds/[id]/tailor/page.tsx`, and the authed branch of `src/app/page.tsx`.
- **Delete** `src/app/api/ask/route.ts`.
- **Modify** `src/components/app-nav.tsx` — drop authed feature links; brand → `/minds`.
- **Modify** `src/app/minds/page.tsx` — host the relocated Activation Checklist.
- **Modify** `src/app/settings/page.tsx` — host the relocated Telegram "Open Bot" link.
- **Modify** `theme.css`/`globals.css` — `.mind-shell-*` sub-header styles; retire `.dash-pivots` usages (keep the class, just unused).

> Verification across this plan is **build + lint + browser** (the repo's pattern for UI/routing; no pure logic to unit-test). Each task ends with `npm run lint` and, where noted, `npm run build`.

---

## Task 1: MindContext

**Files:**
- Create: `src/lib/mind-context.tsx`

- [ ] **Step 1: Create the context + hook**

```tsx
'use client';

import { createContext, useContext } from 'react';

export type MindSummary = { id: string; name: string };

export type MindContextValue = {
  id: string;
  name: string;
  minds: MindSummary[];
};

const MindContext = createContext<MindContextValue | null>(null);

export function MindProvider({ value, children }: { value: MindContextValue; children: React.ReactNode }) {
  return <MindContext.Provider value={value}>{children}</MindContext.Provider>;
}

/** Read the current Mind inside any view rendered by MindShell. */
export function useMind(): MindContextValue {
  const ctx = useContext(MindContext);
  if (!ctx) throw new Error('useMind must be used within MindShell');
  return ctx;
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mind-context.tsx
git commit -m "feat(ia): MindContext for the workspace shell"
```

---

## Task 2: MindShell layout

**Files:**
- Create: `src/app/minds/[id]/layout.tsx`

- [ ] **Step 1: Write the shell**

```tsx
'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback as _unused, useEffect, useMemo, useState } from 'react';
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

  // Active Mind = the URL. Record it so Telegram/quick-capture targets it.
  useEffect(() => {
    if (id) window.localStorage.setItem('muttmind:active-mind-id', id);
  }, [id]);

  // Deep-link ?ask=1 opens the chat overlay.
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
              onChange={(next) => router.push(`/minds/${next}/${tab === 'board' ? '' : tab}`)}
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
          onSaved={() => { /* views re-fetch their own data on focus; nothing global to refresh */ }}
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
```

> Remove the stray `useCallback as _unused` import line — it's a guard against an
> unused-import lint error only if needed; delete it. (Listed here so the implementer
> doesn't leave a dangling import: the final import line is
> `import { Suspense, useEffect, useMemo, useState } from 'react';`.)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean (confirm the React import has no unused names).

- [ ] **Step 3: Commit**

```bash
git add "src/app/minds/[id]/layout.tsx"
git commit -m "feat(ia): MindShell layout — sub-header, tabs, switcher, Ask overlay, last-active write"
```

---

## Task 3: Insights view (rename essays → insights, strip its own chrome)

**Files:**
- Rename: `src/app/minds/[id]/essays/page.tsx` → `src/app/minds/[id]/insights/page.tsx`

- [ ] **Step 1: Move the file**

```bash
mkdir -p "src/app/minds/[id]/insights"
git mv "src/app/minds/[id]/essays/page.tsx" "src/app/minds/[id]/insights/page.tsx"
```

- [ ] **Step 2: Strip the shell-provided chrome**

In the moved file, the shell now owns the outer frame. Remove from the page:
- the `<main className="app-shell ms-shell">` wrapper and `<AppNav active="minds" />` — return the page's `<section className="ms-page essays-page">…</section>` directly (the layout provides `<main>`).
- the `AuthGate` wrapper + `EssaysPage` default export → export the content component directly as default.
- the `<nav className="dash-pivots">…</nav>` block (the shell's tabs replace it).
- the header's **Ask ✦** button and the `askOpen` state + the `<AskPanel … />` mount and its import and the `?ask=1` effect (all now in the shell).
- the `useParams` id usage stays (still needed for API calls) OR switch to `useMind()`; keep `useParams` for minimal change.

Keep everything else (search, Yours/Synthesized lanes, priming toggle, Digest hero, Past syntheses, compose). The page's top-level returned element becomes the `<section className="ms-page essays-page">`.

- [ ] **Step 3: Verify removal**

Run: `git grep -nE "AppNav|AuthGate|dash-pivots|AskPanel|askOpen|setAskOpen" "src/app/minds/[id]/insights/page.tsx"`
Expected: **no output**.

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: compiles; `/minds/[id]/insights` route appears.

- [ ] **Step 5: Commit**

```bash
git add -A "src/app/minds/[id]/insights" "src/app/minds/[id]/essays"
git commit -m "feat(ia): Insights view under the Mind shell (essays → insights, own chrome removed)"
```

---

## Task 4: Board view (move dashboard → /minds/[id], route-scoped)

**Files:**
- Create: `src/app/minds/[id]/page.tsx` (from `dashboard/page.tsx`)

- [ ] **Step 1: Copy the dashboard into the Board route**

```bash
git mv "src/app/dashboard/page.tsx" "src/app/minds/[id]/page.tsx"
```
(`/dashboard` becomes a redirect in Task 8.)

- [ ] **Step 2: Scope to the route Mind (drop the dropdown + global framing)**

In `src/app/minds/[id]/page.tsx`:
- Add `import { useParams } from 'next/navigation';` and read `const { id: mindId } = useParams<{ id: string }>();`.
- Replace the `workspaceId` **state + dropdown selection** with `mindId` from the route. Specifically: delete the `const [workspaceId, setWorkspaceId] = useState('')` and the `workspaces`-driven `Dropdown` in `dash-header`; use `mindId` everywhere `workspaceId` was used. Keep `workspaces` only if still needed for the capture drawer's "Lives in" connect pills (it is) — load it but don't drive selection from it.
- Remove the outer `<main className="app-shell mind-shell">` + `<AppNav active="dashboard" />` and the `<nav className="dash-pivots">` (shell provides both). Return the `<section className="dash-page">…</section>` + the board `<section>` + drawer + modals directly (a fragment `<>…</>`).
- Remove `AuthGate` wrapper + the `Dashboard` default export; export the content component directly as default.
- Remove the **Ask this Mind** button and its `askOpen`/`AskPanel` (shell owns Ask) — already partly done on `main`; delete the remaining `askOpen` state + `<AskPanel/>` mount + import here.
- Move the **ActivationChecklist** out (Task 9) and the **Open Bot** action out (Task 9).

- [ ] **Step 3: Verify removal + route-scoping**

Run: `git grep -nE "AppNav|AuthGate|dash-pivots|setWorkspaceId|<Dropdown|ActivationChecklist|AskPanel" "src/app/minds/[id]/page.tsx"`
Expected: **no output** (ActivationChecklist/Open Bot move in Task 9; if this runs before Task 9, allow ActivationChecklist until then — do Task 9 immediately after).

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: compiles; `/minds/[id]` route renders the Board.

- [ ] **Step 5: Commit**

```bash
git add -A "src/app/minds/[id]/page.tsx" "src/app/dashboard"
git commit -m "feat(ia): Board view at /minds/[id], scoped to the route Mind (dropdown removed)"
```

---

## Task 5: Map view (move vault → /minds/[id]/map, route-scoped)

**Files:**
- Create: `src/app/minds/[id]/map/page.tsx` (from `vault/page.tsx`)

- [ ] **Step 1: Move the file**

```bash
mkdir -p "src/app/minds/[id]/map"
git mv "src/app/vault/page.tsx" "src/app/minds/[id]/map/page.tsx"
```
(`/vault` becomes a redirect in Task 8.)

- [ ] **Step 2: Scope to the route Mind**

In `src/app/minds/[id]/map/page.tsx`:
- Read `const { id: mindId } = useParams<{ id: string }>();` and use it as the workspace id for `/api/nodes/graph?workspaceId=${mindId}`.
- Delete the `workspaceId` state's dropdown/stored-id selection (the `loadWorkspaces` → `next[0]` fallback and `muttmind:active-mind-id` read); the Map always shows the route Mind. The shell already writes last-active.
- Remove the outer `<main>` + `<AppNav active="vault" />` + any `dash-pivots`; return the map content directly. Remove `AuthGate` wrapper + default export wrapper; export the content component as default.

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: compiles; `/minds/[id]/map` renders the route Mind's graph.

- [ ] **Step 4: Commit**

```bash
git add -A "src/app/minds/[id]/map" "src/app/vault"
git commit -m "feat(ia): Map view at /minds/[id]/map, scoped to the route Mind"
```

---

## Task 6: Settings under the shell + fold in Tailor

**Files:**
- Modify: `src/app/minds/[id]/settings/page.tsx`
- (Tailor merge) read `src/app/minds/[id]/tailor/page.tsx` and move its system-prompt UI in.

- [ ] **Step 1: Strip the shell-provided chrome from settings**

Remove the settings page's own `<main>` + `<AppNav>` + any pivots + `AuthGate` wrapper/default export; export the content component directly (the shell wraps it). Keep all settings fields (incl. the Event Starts/Ends added on `main`).

- [ ] **Step 2: Fold Tailor in**

Move the assistant **system-prompt** editing UI from `tailor/page.tsx` into a "Tailor the assistant" section of the settings page (it already PATCHes `/api/workspaces` `systemPrompt`). Keep one save path. (Tailor's route becomes a redirect in Task 8.)

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: compiles; settings shows Tailor + Event + digest in one place.

- [ ] **Step 4: Commit**

```bash
git add -A "src/app/minds/[id]/settings/page.tsx"
git commit -m "feat(ia): Mind settings under the shell, Tailor folded in"
```

---

## Task 7: Retire the Ask page + /api/ask; slim AppNav

**Files:**
- Delete: `src/app/api/ask/route.ts`
- Modify: `src/components/app-nav.tsx`

- [ ] **Step 1: Delete the dead Ask backend**

```bash
git rm src/app/api/ask/route.ts
```
(The standalone `/minds/[id]/ask` page becomes a redirect in Task 8. Chat uses `/api/chat`.)

- [ ] **Step 2: Slim AppNav to brand + search + account**

In `src/components/app-nav.tsx`, remove the four authed feature `<Link>`s (Dashboard/Minds/Map/Settings) from the authed `<nav>` branch. Keep: the brand (→ `/minds` when authed — change `homeHref` to `isAuthed ? '/minds' : '/'`), the `NavSearch` box, and the sign-out. Keep the unauthed What/Login links unchanged. The Mind's Board/Map/Insights tabs now live in `MindShell`.

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: compiles; no references to the deleted route.

- [ ] **Step 4: Commit**

```bash
git add -A src/components/app-nav.tsx src/app/api/ask
git commit -m "feat(ia): retire /api/ask; slim AppNav to brand + search + account"
```

---

## Task 8: Redirects for every legacy route

**Files:**
- Replace bodies: `src/app/dashboard/page.tsx`, `src/app/vault/page.tsx`, `src/app/minds/[id]/essays/page.tsx`, `src/app/minds/[id]/ask/page.tsx`, `src/app/minds/[id]/tailor/page.tsx`
- Modify: `src/app/page.tsx` (authed root)

- [ ] **Step 1: Client redirect helper for last/first Mind**

`/dashboard` and `/vault` have no Mind in scope, so they resolve the last-active (or first) Mind client-side. Create `src/app/dashboard/page.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGate } from '@/components/auth-gate';
import { authedFetch } from '@/lib/client-auth';

function Redirect({ view }: { view: '' | 'map' }) {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      const stored = window.localStorage.getItem('muttmind:active-mind-id');
      let id = stored ?? '';
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

export default function DashboardRedirect() {
  return <AuthGate><Redirect view="" /></AuthGate>;
}
```

- [ ] **Step 2: `/vault` → map redirect**

Create `src/app/vault/page.tsx` reusing the same pattern with `view="map"` (inline the same `Redirect` component, or import a shared one from `src/app/dashboard/page.tsx` — simplest is to copy the small component; DRY via a shared `src/components/mind-redirect.tsx` if preferred).

- [ ] **Step 3: Param-based redirects (essays / ask / tailor)**

These keep the `[id]`, so they can redirect with the param. Create `src/app/minds/[id]/essays/page.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function EssaysRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => { router.replace(`/minds/${id}/insights`); }, [id, router]);
  return null;
}
```

Create the same for `ask/page.tsx` (→ `/minds/${id}/insights`) and `tailor/page.tsx` (→ `/minds/${id}/settings`).

- [ ] **Step 4: Authed root → /minds**

In `src/app/page.tsx`, the authed landing currently goes to `/dashboard` (via AppNav's `homeHref`, already changed in Task 7) — ensure the landing page itself, when a session exists, redirects to `/minds`. If `page.tsx` already renders the marketing home for everyone, add an effect: if authed, `router.replace('/minds')`. (Match the existing auth-check pattern used in `AppNav`/`AuthGate`.)

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: compiles; all five legacy routes + authed `/` resolve to redirects.

- [ ] **Step 6: Commit**

```bash
git add -A src/app/dashboard src/app/vault "src/app/minds/[id]/essays" "src/app/minds/[id]/ask" "src/app/minds/[id]/tailor" src/app/page.tsx
git commit -m "feat(ia): redirect all legacy routes into the Mind workspace"
```

---

## Task 9: Relocate orphaned surfaces

**Files:**
- Modify: `src/app/minds/page.tsx` (Activation Checklist)
- Modify: `src/app/settings/page.tsx` (Telegram "Open Bot")
- Modify: `src/app/minds/[id]/page.tsx` (remove them from the Board)

- [ ] **Step 1: Activation Checklist → the Minds grid**

Move the `<ActivationChecklist milestones={…} />` block (and its `openTelegramBot`/milestone wiring it needs) from the Board (`minds/[id]/page.tsx`) into `src/app/minds/page.tsx` (the home grid). Milestones there read across the user's Minds (create-first-Mind, save-first-capture, tailor, telegram). Remove it from the Board.

- [ ] **Step 2: Telegram "Open Bot" → account settings**

Move the `openTelegramBot` action + button from the Board into `src/app/settings/page.tsx` (global account settings) as a "Connect Telegram" action. Remove it from the Board.

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: compiles; Board no longer references `ActivationChecklist`/`openTelegramBot`.

- [ ] **Step 4: Commit**

```bash
git add -A src/app/minds/page.tsx src/app/settings/page.tsx "src/app/minds/[id]/page.tsx"
git commit -m "feat(ia): relocate Activation Checklist to home grid, Telegram to account settings"
```

---

## Task 10: Shell styles + full build + end-to-end browser verification

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Style the Mind sub-header**

Append to `src/app/globals.css` (match the dark/mono shell — mono uppercase tabs, hairline rules, squared):

```css
.mind-bar { display: flex; align-items: center; gap: 18px; padding: 10px 0; border-bottom: 1px solid rgba(247,247,242,0.1); margin-bottom: 18px; }
.mind-bar__lead { display: flex; align-items: center; gap: 12px; }
.mind-bar__back { font-family: var(--font-mono); font-size: 11px; color: rgba(247,247,242,0.45); text-decoration: none; }
.mind-bar__back:hover { color: var(--ink); }
.mind-tabs { display: flex; gap: 16px; }
.mind-tab { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(247,247,242,0.5); text-decoration: none; padding-bottom: 4px; border-bottom: 2px solid transparent; }
.mind-tab--on { color: var(--ink); border-bottom-color: var(--ink); }
.mind-bar__actions { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.mind-bar__gear { color: rgba(247,247,242,0.5); text-decoration: none; font-size: 15px; }
.mind-bar__gear:hover { color: var(--ink); }
```

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: succeeds; routes present: `/minds`, `/minds/[id]`, `/minds/[id]/map`, `/minds/[id]/insights`, `/minds/[id]/settings`; legacy routes compile as redirects.

- [ ] **Step 3: End-to-end browser checks** (`MUTTMIND_CHAT_ENABLED=1`, `npm run dev`)

1. Authed `/` and `/dashboard` land on a Mind's **Board** (or `/minds` if none); `/vault` lands on a Mind's **Map**.
2. Inside a Mind: **Board / Map / Insights** tabs switch views; the Mind name + switcher + gear + **Ask ✦** show once (no `dash-pivots`, no duplicate Ask button).
3. The **switcher** changes Minds and stays on the same tab.
4. **Ask ✦** opens the overlay on all three tabs; sending/saving still works.
5. Capture on the Board saves into the **route Mind**; "Lives in" connect pills still add to other Minds.
6. `/minds/[id]/essays`, `/ask`, `/tailor` redirect to `/insights`, `/insights`, `/settings`.
7. Activation Checklist shows on the **Minds grid**; **Connect Telegram** is in **account settings**.
8. Top bar shows only brand + search + account; brand → `/minds`.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(ia): Mind sub-header styles; finalize workspace shell migration"
```

---

## Self-review notes

- **Spec coverage:** one nav + MindShell (T1/T2), Board/Map/Insights as route children scoped by URL (T3/T4/T5), Ask omnipresent in the shell (T2), settings + Tailor consolidation (T6), `/api/ask` + Ask page retired (T7/T8), all redirects incl. authed `/` (T8), orphan relocation — Activation Checklist + Telegram + (Synthesize already gone on main) (T9), last-active write path moved to the shell (T2), AppNav slimmed (T7). ✓
- **Out of scope (separate plans):** cross-Mind search (#2) — top-bar search keeps current `?q` behavior here; multi-scope Ask (#3) — Ask stays single-Mind (the shell passes the route `workspaceId`).
- **Type/name consistency:** `useMind()`/`MindProvider` from `mind-context`; the shell passes `workspaceId={id}` to the existing `AskPanel` (single-Mind signature unchanged); tab detection by `usePathname` suffix.
- **Known sequencing:** Task 9 must follow Task 4 (it removes Board-resident surfaces); the Task 4 grep allows `ActivationChecklist` until Task 9.
```
