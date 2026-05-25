# Mind-as-Workspace — information-architecture redesign (Direction A)

Date: 2026-05-23
Status: design — awaiting user review

## Context

A UX audit found the app's unit is the **Mind**, but the app is organized by **feature**,
with two competing navigations and an ambiguous "active Mind":

- Top nav (global): Dashboard · Minds · Map · Settings
- In-page pivots (mind-scoped): Minds · Dashboard · Map · Insights

They overlap (Dashboard/Minds/Map) and disagree on scope; the active Mind is a *dropdown*
on `/dashboard` but the *URL* on `/minds/[id]/…`. A single Mind is smeared across six
surfaces (`/dashboard`, `/vault`, `/minds/[id]/essays`, `/minds/[id]/ask`,
`/minds/[id]/settings`, `/minds/[id]/tailor`). This is the root of recurring confusion
(e.g., "I saved from chat and can't find it" — chat and its output lived on different pages).

**Direction A** (chosen from A/B mockups): make the **Mind the room**. One navigation. Views
of a Mind are tabs. Chat (Ask) is an omnipresent overlay. Capture is per-Mind. This is the
most Are.na-honest model (calm, content-first, "you're always in a channel").

## Target information architecture

**Global home — the Minds grid** (`/minds`): a grid of the user's Minds + "New Mind". The
authed root (`/`) and `/dashboard` redirect here. The home is for *choosing/creating* a Mind,
not a feature page. (No global capture box in v1 — see Decisions.)

**Mind workspace** (`/minds/[id]/…`): a shared shell wrapping three views, with the Mind's
name + a **Mind switcher** dropdown + a **settings gear** in the header, and one row of view
tabs:

- **Board** — `/minds/[id]` (default view) — the capture composer + masonry of captures.
  This is today's `/dashboard`, scoped to this Mind (no Mind dropdown — the URL is the Mind).
- **Map** — `/minds/[id]/map` — this Mind's relationship graph (today's `/vault`, scoped).
- **Insights** — `/minds/[id]/insights` — the library-first + chat page (today's
  `/minds/[id]/essays`; route renamed).

**Ask ✦** — the existing `AskPanel` overlay, mounted once by the shell so it's available on
every view inside the Mind. The standalone `/minds/[id]/ask` page is removed.

**Settings** — the gear opens `/minds/[id]/settings`, consolidating today's per-Mind settings
+ **Tailor** (system prompt) + the weekly-digest prompt. Global **account** settings stay at
`/settings`.

## One navigation (collapse the two systems)

- **Delete the in-page `dash-pivots`** entirely.
- **`AppNav` becomes the thin global bar:** brand → home (Minds grid), global search, account
  (sign out). It no longer lists Dashboard/Minds/Map/Settings as peers.
- **The Mind's view tabs (Board/Map/Insights) live in the Mind shell**, not the global bar —
  so "global" vs "this Mind" is unambiguous.
- **Active Mind = the URL.** The Dashboard's Mind dropdown is removed; switching Minds happens
  via the header switcher, which navigates to `/minds/[newId]/<same view>`.

## Capture (per-Mind)

- Capture lives on a Mind's **Board** and always saves *into that Mind*.
- After capture, a card can be **added to other Minds** — reuse the existing connect feature
  (`/api/nodes/[id]/connect`, the "Lives in" pills in the capture drawer).
- The Telegram bot / paste-anywhere continues to target the user's **last-active Mind**. Today
  that id is written by the deleted Dashboard dropdown — so the write path moves: **`MindShell`
  records the current Mind as last-active on entry, and the Mind switcher updates it on pick.**
  Without this, Telegram capture silently drifts to a stale Mind.

## Component plan

- **New `MindShell`** (`src/app/minds/[id]/layout.tsx`): renders the Mind header (name +
  switcher + gear), the Board/Map/Insights tab row, mounts `AskPanel` once, and renders the
  active child view. Loads the Mind once and shares it via context to avoid per-view refetch.
- **Board view** = today's `dashboard/page.tsx` content, moved under `/minds/[id]`, with the
  Mind taken from the route (drop the workspace dropdown + the global-dashboard framing).
- **Map view** = today's `vault/page.tsx`, scoped to the route Mind.
- **Insights view** = today's `essays/page.tsx`, minus its own pivots/Ask button (the shell
  provides them). The Insights page's `askOpen` state, the "Ask ✦" button, and the `?ask=1`
  deep-link all **move to `MindShell`** — otherwise there'd be two Ask buttons. The Insights
  view keeps only its library + lanes + library-search.
- **Retire**: the `dash-pivots` markup across pages; the `/minds/[id]/ask` page **and its
  `/api/ask` route** (superseded by `/api/chat`); the `SynthesizeModal` + Synthesize button; the
  Mind dropdown on the dashboard; `AppNav`'s authed feature links.

## Route migration & redirects

| Old | New | Action |
|---|---|---|
| `/` (authed) | `/minds` | redirect authed root to the grid |
| `/dashboard` | `/minds/[lastOrFirst]` | redirect (grid if no Minds) |
| `/vault` | `/minds/[id]/map` | Map becomes per-Mind; redirect |
| `/minds/[id]/essays` | `/minds/[id]/insights` | rename; redirect old |
| `/minds/[id]/ask` | `/minds/[id]/insights` | remove page; Ask is the overlay |
| `/minds/[id]/tailor` | `/minds/[id]/settings` | fold Tailor into Mind settings |

Keep redirects for any externally-shared old URLs so nothing dead-links.

## Orphaned surfaces (resolved)

Things that live on today's `/dashboard` or global nav and need an explicit home in the new IA:

- **Global search box (`AppNav`) → first-class cross-Mind search.** It stays in the top bar
  but its meaning changes: it now searches **across all Minds the user belongs to** and shows
  results **grouped by Mind**, each result linking into that Mind's Board/Insights at the item.
  Contextual search still exists *within* a surface (Board capture filter, Insights library
  search, "filter Minds" on the home). See the dedicated section below.
- **`SynthesizeModal` + the dashboard "Synthesize" button → deleted.** On-demand synthesis was
  already replaced by chat (the Insights "Full essay" path). The Board does not get a
  Synthesize action.
- **Activation Checklist → the home grid** (Minds grid), where onboarding milestones
  ("create your first Mind", "save your first capture", "tailor your assistant") naturally belong.
- **"Open Bot" / Telegram link → account settings (`/settings`).** Linking Telegram is an
  account-level action, not a per-Mind one. (Per-Mind "save from Telegram" still routes to the
  last-active Mind.)

## Cross-Mind search & multi-scope Ask (first-class)

Two capabilities the Mind-as-room model must support without breaking the "one nav" calm.

### Cross-Mind search
- **Entry:** the global top-bar search box (`AppNav`), available everywhere.
- **Backend:** new `GET /api/search?q=…` (no `workspaceId` in scope). It must **resolve the
  user's member workspaces server-side first, then restrict the query to those** (list-then-
  filter) — not trust a caller-supplied id — so results never leak across membership. Searches
  **captures** (title, summary, tags, notes, url) and **insights** (title, body). v1 = text
  match (Postgres `ilike`/trigram); semantic ranking is a fast-follow (node embeddings exist).
- **Results:** grouped by Mind, each row links to the item in its Mind (Board card drawer, or
  Insights). Captures and insights labeled by kind.
- **Per-surface search stays:** Board capture filter and Insights library search are unchanged.

### Multi-scope Ask
The `AskPanel` gains a **scope selector** at the top: **This Mind** (default when opened inside
a Mind) · **Select Minds…** (multi-pick) · **All Minds**. Opened from the **home grid**, it
defaults to **All Minds** (there's no single Mind there).

- **Backend:** extend `POST /api/chat` to accept a scope — `workspaceIds: string[]` (or
  `scope: 'all'` resolved server-side to the user's Minds). Membership is checked for **every**
  workspace in scope. Retrieval embeds the query and ranks captures **across all in-scope
  Minds**, with a **per-Mind cap and a total top-K ceiling** so a 10-Mind scope can't blow the
  prompt or starve any single Mind.
- **Insight priming under multi-Mind scope:** `formatInsightsForPrompt`'s fixed 4000/1500 char
  caps don't divide sensibly across many Minds. Apply a **per-Mind insight budget plus a total
  ceiling**, and (fast-follow) rank insights by query relevance before packing. Muted insights
  stay filtered. Note this so an All-Minds answer doesn't silently feel thin.
- **Citations carry Mind identity.** Today `/api/chat` emits `{index, nodeId, title, url}`.
  Add `workspaceId` + Mind `name` to each citation, and have `AskPanel` render the Mind label in
  multi-Mind mode, so a cross-Mind answer is traceable.
- **Save target:** single-Mind scope saves as today. Multi/All scope **prompts for a destination
  Mind**, with this default order: the Mind you opened from → the most-cited Mind → the only Mind
  that had hits → if none resolve, no default (require an explicit pick). Saved answer is an
  insight in that Mind, muted as usual.
- **Scope persistence:** a chosen scope (incl. a "Select Minds…" set) **persists for the session**
  so users don't re-pick on every open; it resets to the context default (This Mind / All from
  home) on a fresh session.
- This bends the pure "Mind is the room" model intentionally: Ask is omnipresent *and* can rise
  above a single Mind. The scope selector makes the current reach explicit, preserving the calm.

## Decisions flagged for review

1. **Global Map dropped in v1.** The cross-Mind map goes away; Map is per-Mind. A cross-Mind
   overview belongs with the parked "organize-at-scale / Photos-model" work, not here.
2. **No global quick-capture in v1.** You're always inside a Mind to capture; the home grid is
   for choosing/creating. (Telegram still captures to last-active Mind.) Revisit a global
   "Unsorted inbox" later if it's missed.
3. **Sequencing (merge-strict).** This migration **must not start until the chat branch
   (`feature/library-first-insights-chat`) is merged into `main` and Task 12's e2e checklist is
   signed off.** It restructures the exact pages chat touches (Insights, Board, Ask overlay);
   starting earlier means rebasing a large refactor against unmerged work.
4. **Cross-surface refactor cost.** Board/Map/Insights each fetch the workspace independently
   today. The `MindShell`-loads-once pattern requires refactoring each child view to read the
   Mind from shared context — real work to scope in the plan, not a freebie.
5. **Cross-Mind Ask save target.** Recommended: a multi/all-Mind answer's Save action prompts
   for a destination Mind (default = the Mind you opened from, else the most-cited Mind). Confirm
   that vs. always saving to a fixed "default" Mind.
6. **Cross-Mind search depth (v1).** Recommended: text match first (ships fast), semantic
   ranking as a fast-follow. Confirm you're OK starting with text search.

## Verification

- Every old route in the table above redirects correctly; no dead links anywhere in the app.
- Exactly **one** navigation; the active Mind is always derivable from the URL.
- `AskPanel` opens and works on Board, Map, and Insights.
- Capture saves into the current Mind; "add to other Minds" still works from a card.
- Settings gear surfaces Tailor + digest prompt in one place; account settings unaffected.
- The Minds grid is the home for authed users; `/` and `/dashboard` land there.
- **Cross-Mind search:** a query from the top bar returns matches from *multiple* Minds, grouped
  by Mind, and only from Minds the user belongs to (no leakage across membership).
- **Multi-scope Ask:** the scope selector switches This Mind / Select Minds / All Minds; an
  All-Minds answer cites sources from more than one Mind with the Mind shown; Save prompts for a
  destination Mind.
