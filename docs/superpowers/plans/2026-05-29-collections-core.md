# Collections Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Collections" composing surface — a top-level `/collections` home and per-Collection editor that lets a user arrange captures and text blocks into an authored, presentable artifact (Editorial view only in this plan; lenses + public publish come in plans #3 / #4).

**Architecture:** New tables (`collections`, `collection_items`, `collection_members`) sit alongside `nodes` and reference them. Items reference captures by `node_id` (`ON DELETE SET NULL` so deletes orphan rather than cascade). Authorization splits two ways: a Collection is owned by a user (not a workspace), so editor access is gated by `owner_user_id === userId` OR a row in `collection_members` (role `'editor'`). Capture *visibility* for the add-time check still goes through workspace membership (a user can only add captures from Minds they're a member of), with a Shared-Mind cross-publish opt-in.

**Tech Stack:** Next.js 15 App Router (server-side data via route handlers, client components for editor), Supabase Postgres + service-role admin client (auth gate via `assertSession` + custom collection helpers), Tailwind via the existing `ms-*` class system, `@dnd-kit/sortable` (new) for drag-to-reorder, vitest for pure logic.

---

## Plan Map

```
Migration                       → Task 1
Pure helpers + tests            → Tasks 2, 3
Auth helper                     → Task 4
Collections list/create API     → Task 5
Collection detail/update API    → Task 6
Items API (add / patch / delete)→ Tasks 7, 8, 9
Members (editor invites) API    → Task 10
Mind cross-publish setting API  → Task 11
AppNav link                     → Task 12
Collections home page           → Task 13
Editor — header + metadata      → Task 14
Editor — list rendering         → Task 15
Editor — drag-to-reorder        → Task 16
Editor — text blocks            → Task 17
Editor — item captions          → Task 18
Editor — cover image picker     → Task 19
Editor — manage editors         → Task 20
AddToCollection picker          → Task 21
Drawer entry point              → Task 22
Board multi-select entry point  → Task 23
Search results entry point      → Task 24
Mind Settings — toggle UI       → Task 25
Build + verify                  → Task 26
```

## File Structure

**Create:**
- `supabase/collections_patch.sql` — migration for all new tables/columns
- `src/lib/collections.ts` — shared types (`Collection`, `CollectionItem`, `CollectionMember`) + pure helpers (`canAddCaptureToCollection`, `compactPositions`)
- `src/lib/collections.test.ts` — vitest for the pure helpers
- `src/lib/collection-auth.ts` — `assertCollectionEditor(supabase, collectionId, userId)`
- `src/app/api/collections/route.ts` — GET list, POST create
- `src/app/api/collections/[collectionId]/route.ts` — GET detail (editor view), PATCH metadata, DELETE
- `src/app/api/collections/[collectionId]/items/route.ts` — POST add
- `src/app/api/collections/[collectionId]/items/[itemId]/route.ts` — PATCH (caption/text/position), DELETE
- `src/app/api/collections/[collectionId]/members/route.ts` — GET / POST invite / DELETE
- `src/app/api/workspaces/[workspaceId]/cross-publish/route.ts` — PATCH `allow_member_cross_publish`
- `src/app/collections/page.tsx` — Collections home server component
- `src/app/collections/CollectionsHome.tsx` — Collections home client component (grid + New Collection)
- `src/app/collections/[collectionId]/page.tsx` — Editor server entry
- `src/app/collections/[collectionId]/CollectionEditor.tsx` — Editor client component (the big one)
- `src/components/AddToCollection.tsx` — Reusable picker modal

**Modify:**
- `src/components/AppNav.tsx` — add "Collections" link
- `src/app/minds/[id]/page.tsx` — drawer "Add to Collection" + board multi-select "Add to Collection"
- `src/app/search/page.tsx` — per-row "Add to Collection" (capture rows only)
- `src/app/minds/[id]/settings/page.tsx` — cross-publish toggle (Shared Minds only)
- `package.json` — add `@dnd-kit/core` and `@dnd-kit/sortable`

**Reference patterns (read but don't modify):**
- `src/lib/auth.ts` — existing `assertWorkspaceMember`, `assertSession` patterns
- `src/app/api/nodes/route.ts` — example list endpoint shape (SELECT string, NodeListRow, error handling)
- `src/app/api/nodes/[nodeId]/route.ts` — example PATCH endpoint shape
- `src/components/MindShell.tsx` (or whatever lays out a Mind) — for component conventions

---

## Conventions Used Throughout (REAL CODEBASE PATTERNS — these override any contrary code shown in task examples below)

> **Important:** the route-handler code blocks in tasks 5–11 use an illustrative `assertSession`/`getAdminSupabase` shape that does **not** match this codebase. Use the patterns below — and mirror `src/app/api/nodes/route.ts` (the GET handler is the canonical example) — when implementing each route.

- **Auth — throw + try/catch.** Routes call `requireUserId(req)` (from `@/lib/auth`) which **throws** if the bearer token is missing or invalid. Workspace gating uses `assertWorkspaceMember(workspaceId, userId)` (from `@/lib/workspace`) which **throws** `'Not a workspace member'` if the user isn't in the workspace. Catch in the route and return `Response.json({ error }, { status: 401 })`:
  ```ts
  import { requireUserId } from '@/lib/auth';
  import { getSupabaseAdmin } from '@/lib/supabase';
  import { assertWorkspaceMember } from '@/lib/workspace';

  export async function GET(req: Request) {
    try {
      const userId = await requireUserId(req);
      // ...query against getSupabaseAdmin()...
      return Response.json({ ... });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unauthorized';
      return Response.json({ error: msg }, { status: 401 });
    }
  }
  ```
- **Admin client:** `getSupabaseAdmin()` from `@/lib/supabase` — service role, used for every DB call in route handlers.
- **Response shape:** `Response.json(...)` (Web Fetch API, not `NextResponse.json`).
- **Dynamic params:** Next.js 15 — `{ params }: { params: Promise<{ key: string }> }` and `const { key } = await params;`. Mirror what `src/app/api/nodes/[nodeId]/route.ts` does.
- **`authedFetch`:** lives at `@/lib/client-auth`, used by every client component to attach the bearer token. Always include `headers: { 'content-type': 'application/json' }` when sending a JSON body — check existing call sites (e.g. `src/app/minds/[id]/page.tsx`'s `savePublishedAt`) for the exact shape.
- **camel ↔ snake:** DB columns are snake_case, TypeScript is camelCase, mapped explicitly at the API boundary (don't pass raw rows out).
- **Node column names** (relevant to Task 6's join): the OG image column is `og_image_url`, *not* `og_image`. Mirror `NodeListRow` in `src/app/api/nodes/route.ts` for the canonical column list.
- **Workspace ownership column:** `workspaces.created_by` (the user who created the Mind). Task 11 (Mind cross-publish toggle) checks `created_by === userId`, not `owner_user_id`.
- **`workspace_members.role`:** values are `'owner' | 'admin' | 'member'`. `assertWorkspaceAdmin` exists for admin/owner gating.
- **Plain text only:** `caption` and `text_body` are stored as plain text. The editor uses `<textarea>`. Rendered with `whiteSpace: 'pre-wrap'`. **No `dangerouslySetInnerHTML` anywhere on Collections in this plan** — public XSS surface won't exist until plan #4, but this discipline starts now.
- **Optimistic UI:** the editor mutates local state first, then PATCHes. On error, revert + show status. Match the `updateCapture` pattern in `src/app/minds/[id]/page.tsx`.
- **Styling:** existing `ms-*` classes (in `src/app/globals.css` starting around line 5100) include `ms-page`, `ms-field`, `ms-field__label`, `ms-input`, `ms-btn`, `ms-btn--ghost`. The plan's task examples occasionally reference `ms-card`, `ms-grid`, `ms-section-heading`, `ms-modal`, `ms-collection-*` — **these do not exist yet**. When a task uses one of those classes, either add a minimal rule to `src/app/globals.css` (following the surrounding style — neutral palette, small radii, mono-ish meta text) or fall back to plain `<div>` + inline minimal styling. Don't introduce a separate stylesheet.
- **`AppNav` file path:** `src/components/app-nav.tsx` (kebab-case). Exports `function AppNav({ active }: AppNavProps)`. Add `'collections'` to the `active` union.
- **`collection-auth.ts` convention (Task 4 override):** match `assertWorkspaceMember`'s throw-on-fail signature instead of the `{ ok, error }` shape shown in the example. Recommended signatures:
  ```ts
  export async function assertCollectionEditor(collectionId: string, userId: string): Promise<{ isOwner: boolean }>;
  export async function assertCollectionOwner(collectionId: string, userId: string): Promise<void>;
  ```
  Throw `'Collection not found'`, `'Not an editor of this Collection'`, or `'Owner-only action'`. Routes catch and map to 401/403/404 status. Use `getSupabaseAdmin()` inside the helper rather than receiving a client as a parameter.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/collections_patch.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/collections_patch.sql`:
```sql
-- Collections — archive as creative form (plan #2 of 4)

-- Workspaces gain a cross-publish opt-in (used at add-time and on render in plan #4)
alter table public.workspaces
  add column if not exists allow_member_cross_publish boolean not null default false;

-- Collections themselves
create table if not exists public.collections (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references public.users(id) on delete cascade,
  title           text not null default 'Untitled Collection',
  description     text,
  cover_path      text,
  default_view    text not null default 'editorial',
  enabled_views   text[] not null default array['editorial']::text[],
  show_summary    boolean not null default false,
  show_tags       boolean not null default false,
  show_notes      boolean not null default false,
  status          text not null default 'draft',
  share_code      text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists collections_owner_idx on public.collections(owner_user_id);

-- Items within a collection (capture references or curator text blocks)
create table if not exists public.collection_items (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  position      integer not null,
  kind          text not null,
  node_id       uuid references public.nodes(id) on delete set null,
  caption       text,
  text_body     text,
  created_at    timestamptz not null default now(),
  constraint collection_items_kind_chk
    check (kind in ('capture','text')),
  constraint collection_items_capture_has_node_chk
    check (kind <> 'capture' or node_id is not null),
  constraint collection_items_text_has_body_chk
    check (kind <> 'text' or text_body is not null)
);

create index if not exists collection_items_collection_idx
  on public.collection_items(collection_id, position);

-- Editor invites (owner is implicit; not duplicated here)
create table if not exists public.collection_members (
  collection_id uuid not null references public.collections(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  role          text not null default 'editor',
  invited_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (collection_id, user_id),
  constraint collection_members_role_chk check (role in ('editor'))
);
```

> Note: the table name `public.users` matches the existing reference target used elsewhere in this repo. If a quick `grep "references public.users" supabase/` shows a different name (e.g. `public.app_users` or `auth.users`), substitute that name in the foreign-key references above before applying. The implementer should check before running psql.

- [ ] **Step 2: Apply the migration**

Read `SUPABASE_DB_PASSWORD` from `.env.local`. Run:
```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
  -h <host-from-.env.local> -U postgres -d postgres \
  -f supabase/collections_patch.sql
```

- [ ] **Step 3: Verify the migration**

Run psql with `\d public.collections`, `\d public.collection_items`, `\d public.collection_members`, and `\d public.workspaces` — confirm:
- `collections` has all listed columns including `enabled_views text[]`, `share_code text` (unique), `status text`
- `collection_items` has the three CHECK constraints
- `collection_members` PK is `(collection_id, user_id)`
- `workspaces.allow_member_cross_publish boolean` default false

- [ ] **Step 4: Commit**

```bash
git checkout -b feature/collections-core
git add supabase/collections_patch.sql
git commit -m "feat(db): collections, collection_items, collection_members + workspaces.allow_member_cross_publish"
```

---

### Task 2: Pure helper — `canAddCaptureToCollection`

**Files:**
- Create: `src/lib/collections.ts`
- Create: `src/lib/collections.test.ts`

This helper encodes the Shared-Mind cross-publish rule for the add-time check. The route handler that adds an item calls it after a database lookup; this function takes pre-fetched inputs and is purely synchronous so it can be tested without a database.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/collections.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { canAddCaptureToCollection } from './collections';

describe('canAddCaptureToCollection', () => {
  const baseInput = {
    actorUserId: 'u1',
    nodeCreatedBy: 'u1',
    workspaceAllowMemberCrossPublish: false,
  };

  it('allows the actor to add their own capture when toggle is off', () => {
    expect(canAddCaptureToCollection(baseInput)).toEqual({ ok: true });
  });

  it('denies adding another member\'s capture when toggle is off', () => {
    expect(canAddCaptureToCollection({
      ...baseInput,
      nodeCreatedBy: 'u2',
    })).toEqual({
      ok: false,
      reason: 'cross_publish_disabled',
    });
  });

  it('allows adding another member\'s capture when toggle is on', () => {
    expect(canAddCaptureToCollection({
      ...baseInput,
      nodeCreatedBy: 'u2',
      workspaceAllowMemberCrossPublish: true,
    })).toEqual({ ok: true });
  });

  it('allows adding own capture when toggle is on', () => {
    expect(canAddCaptureToCollection({
      ...baseInput,
      workspaceAllowMemberCrossPublish: true,
    })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/collections.test.ts
```
Expected: FAIL — `canAddCaptureToCollection` not exported.

- [ ] **Step 3: Implement the helper**

Create `src/lib/collections.ts`:
```ts
export type CollectionView = 'editorial' | 'gallery' | 'timeline';

export type CollectionStatus = 'draft' | 'published';

export type CollectionItemKind = 'capture' | 'text';

export interface Collection {
  id: string;
  ownerUserId: string;
  title: string;
  description: string | null;
  coverPath: string | null;
  defaultView: CollectionView;
  enabledViews: CollectionView[];
  showSummary: boolean;
  showTags: boolean;
  showNotes: boolean;
  status: CollectionStatus;
  shareCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionItem {
  id: string;
  collectionId: string;
  position: number;
  kind: CollectionItemKind;
  nodeId: string | null;
  caption: string | null;
  textBody: string | null;
  createdAt: string;
}

export interface CollectionMember {
  collectionId: string;
  userId: string;
  role: 'editor';
  invitedBy: string | null;
  createdAt: string;
}

export interface CanAddInput {
  actorUserId: string;
  nodeCreatedBy: string;
  workspaceAllowMemberCrossPublish: boolean;
}

export type CanAddResult =
  | { ok: true }
  | { ok: false; reason: 'cross_publish_disabled' };

export function canAddCaptureToCollection(input: CanAddInput): CanAddResult {
  if (input.actorUserId === input.nodeCreatedBy) return { ok: true };
  if (input.workspaceAllowMemberCrossPublish) return { ok: true };
  return { ok: false, reason: 'cross_publish_disabled' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/collections.test.ts
```
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collections.ts src/lib/collections.test.ts
git commit -m "feat(collections): types + canAddCaptureToCollection helper"
```

---

### Task 3: Pure helper — `compactPositions`

**Files:**
- Modify: `src/lib/collections.ts`
- Modify: `src/lib/collections.test.ts`

When a user drags an item, the editor re-emits a complete ordered list of `{id, position}` pairs. The route handler runs them through `compactPositions` to normalize gaps and produce a contiguous `[0, 1, 2, …]` sequence before writing.

- [ ] **Step 1: Add failing tests**

Append to `src/lib/collections.test.ts`:
```ts
import { compactPositions } from './collections';

describe('compactPositions', () => {
  it('preserves order and produces 0-indexed contiguous positions', () => {
    expect(compactPositions([
      { id: 'a', position: 5 },
      { id: 'b', position: 12 },
      { id: 'c', position: 0 },
    ])).toEqual([
      { id: 'c', position: 0 },
      { id: 'a', position: 1 },
      { id: 'b', position: 2 },
    ]);
  });

  it('handles already-contiguous input as identity', () => {
    expect(compactPositions([
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'c', position: 2 },
    ])).toEqual([
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'c', position: 2 },
    ]);
  });

  it('is stable on ties (input order wins)', () => {
    expect(compactPositions([
      { id: 'a', position: 1 },
      { id: 'b', position: 1 },
    ])).toEqual([
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(compactPositions([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/collections.test.ts
```
Expected: FAIL — `compactPositions` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/collections.ts`:
```ts
export interface Positioned { id: string; position: number; }

export function compactPositions<T extends Positioned>(items: T[]): T[] {
  return items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => {
      const d = a.item.position - b.item.position;
      return d !== 0 ? d : a.originalIndex - b.originalIndex;
    })
    .map(({ item }, newIndex) => ({ ...item, position: newIndex }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/collections.test.ts
```
Expected: PASS — 4 (canAdd) + 4 (compact) = 8 tests in this file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collections.ts src/lib/collections.test.ts
git commit -m "feat(collections): compactPositions helper for reorder normalization"
```

---

### Task 4: Auth helper — `assertCollectionEditor`

**Files:**
- Create: `src/lib/collection-auth.ts`

A small server-side helper that throws (or returns an error sentinel) if the caller isn't the owner or in `collection_members` as `'editor'`. Match whatever pattern `src/lib/auth.ts` uses for `assertWorkspaceMember`.

- [ ] **Step 1: Read the existing auth pattern**

Read `src/lib/auth.ts` first. Note the return type and error convention of `assertWorkspaceMember` (e.g. does it throw, return `null`, or return `{ok, error}`). Match that convention.

- [ ] **Step 2: Implement**

Create `src/lib/collection-auth.ts`. Use the convention from `auth.ts`. The shape below assumes the pattern returns `{ok, error}`; adapt if `assertWorkspaceMember` throws instead:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type CollectionAuthResult =
  | { ok: true; isOwner: boolean }
  | { ok: false; status: 401 | 403 | 404; error: string };

export async function assertCollectionEditor(
  supabase: SupabaseClient,
  collectionId: string,
  userId: string,
): Promise<CollectionAuthResult> {
  const { data: collection, error: cErr } = await supabase
    .from('collections')
    .select('owner_user_id')
    .eq('id', collectionId)
    .maybeSingle();

  if (cErr) return { ok: false, status: 401, error: cErr.message };
  if (!collection) return { ok: false, status: 404, error: 'Collection not found.' };

  if (collection.owner_user_id === userId) {
    return { ok: true, isOwner: true };
  }

  const { data: member, error: mErr } = await supabase
    .from('collection_members')
    .select('user_id')
    .eq('collection_id', collectionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (mErr) return { ok: false, status: 401, error: mErr.message };
  if (!member) return { ok: false, status: 403, error: 'Not an editor of this Collection.' };

  return { ok: true, isOwner: false };
}

export async function assertCollectionOwner(
  supabase: SupabaseClient,
  collectionId: string,
  userId: string,
): Promise<CollectionAuthResult> {
  const r = await assertCollectionEditor(supabase, collectionId, userId);
  if (!r.ok) return r;
  if (!r.isOwner) return { ok: false, status: 403, error: 'Owner-only action.' };
  return r;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/collection-auth.ts
git commit -m "feat(collections): assertCollectionEditor + assertCollectionOwner"
```

---

### Task 5: API — list + create Collections

**Files:**
- Create: `src/app/api/collections/route.ts`

Two handlers: `GET` returns the current user's owned + invited Collections (a curator may want to see both); `POST` creates a fresh draft and returns its id so the client can redirect to the editor.

- [ ] **Step 1: Read reference shapes**

Read `src/app/api/nodes/route.ts` to confirm the session/admin-client pattern. Match its imports and error shapes.

- [ ] **Step 2: Implement**

Create `src/app/api/collections/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { assertSession } from '@/lib/auth';
import { getAdminSupabase } from '@/lib/supabase-admin';
import type { Collection, CollectionView, CollectionStatus } from '@/lib/collections';

interface Row {
  id: string;
  owner_user_id: string;
  title: string;
  description: string | null;
  cover_path: string | null;
  default_view: string;
  enabled_views: string[];
  show_summary: boolean;
  show_tags: boolean;
  show_notes: boolean;
  status: string;
  share_code: string | null;
  created_at: string;
  updated_at: string;
}

function toCollection(r: Row): Collection {
  return {
    id: r.id,
    ownerUserId: r.owner_user_id,
    title: r.title,
    description: r.description,
    coverPath: r.cover_path,
    defaultView: r.default_view as CollectionView,
    enabledViews: r.enabled_views as CollectionView[],
    showSummary: r.show_summary,
    showTags: r.show_tags,
    showNotes: r.show_notes,
    status: r.status as CollectionStatus,
    shareCode: r.share_code,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SELECT =
  'id, owner_user_id, title, description, cover_path, default_view, enabled_views, show_summary, show_tags, show_notes, status, share_code, created_at, updated_at';

export async function GET(req: NextRequest) {
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });
  const supabase = getAdminSupabase();

  const { data: owned, error: ownedErr } = await supabase
    .from('collections')
    .select(SELECT)
    .eq('owner_user_id', session.userId)
    .order('updated_at', { ascending: false });
  if (ownedErr) return NextResponse.json({ error: ownedErr.message }, { status: 500 });

  const { data: invitedRows, error: invErr } = await supabase
    .from('collection_members')
    .select('collection_id')
    .eq('user_id', session.userId);
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  const invitedIds = (invitedRows ?? []).map((r) => r.collection_id as string);

  let invited: Row[] = [];
  if (invitedIds.length) {
    const { data, error } = await supabase
      .from('collections')
      .select(SELECT)
      .in('id', invitedIds)
      .order('updated_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    invited = data ?? [];
  }

  return NextResponse.json({
    owned: (owned ?? []).map(toCollection),
    invited: invited.map(toCollection),
  });
}

export async function POST(req: NextRequest) {
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const title = typeof body.title === 'string' && body.title.trim().length > 0
    ? body.title.trim().slice(0, 200)
    : 'Untitled Collection';

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from('collections')
    .insert({ owner_user_id: session.userId, title })
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ collection: toCollection(data as Row) });
}
```

> If `assertSession` signature differs from the assumed `{ ok, userId, error }` shape, adapt: the principle is "401 if no session, else proceed using the user id."

- [ ] **Step 3: Verify build**

```bash
npm run build
```
Expected: `Compiled successfully` and the route shows up in the routes table.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/collections/route.ts
git commit -m "feat(api): GET/POST /api/collections"
```

---

### Task 6: API — Collection detail / metadata / delete

**Files:**
- Create: `src/app/api/collections/[collectionId]/route.ts`

`GET` returns the Collection plus its ordered items (joined to the underlying node for capture items) and its editor list. `PATCH` updates metadata (title, description, cover_path, enabled_views, default_view, show_summary, show_tags, show_notes). `DELETE` is owner-only.

- [ ] **Step 1: Implement**

Create `src/app/api/collections/[collectionId]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { assertSession } from '@/lib/auth';
import { getAdminSupabase } from '@/lib/supabase-admin';
import {
  assertCollectionEditor,
  assertCollectionOwner,
} from '@/lib/collection-auth';
import type {
  Collection, CollectionItem, CollectionItemKind,
  CollectionStatus, CollectionView,
} from '@/lib/collections';

interface CollectionRow {
  id: string; owner_user_id: string; title: string; description: string | null;
  cover_path: string | null; default_view: string; enabled_views: string[];
  show_summary: boolean; show_tags: boolean; show_notes: boolean;
  status: string; share_code: string | null;
  created_at: string; updated_at: string;
}
interface ItemRow {
  id: string; collection_id: string; position: number;
  kind: string; node_id: string | null;
  caption: string | null; text_body: string | null; created_at: string;
}
interface NodeJoinRow {
  id: string; title: string | null; original_url: string | null;
  og_image: string | null; media_path: string | null;
  scrape_kind: string | null; published_at: string | null;
  created_at: string; created_by: string | null;
  workspace_id: string;
}

const C_SELECT = 'id, owner_user_id, title, description, cover_path, default_view, enabled_views, show_summary, show_tags, show_notes, status, share_code, created_at, updated_at';
const ITEM_SELECT = 'id, collection_id, position, kind, node_id, caption, text_body, created_at';
const NODE_SELECT = 'id, title, original_url, og_image, media_path, scrape_kind, published_at, created_at, created_by, workspace_id';

function toCollection(r: CollectionRow): Collection {
  return {
    id: r.id, ownerUserId: r.owner_user_id, title: r.title, description: r.description,
    coverPath: r.cover_path, defaultView: r.default_view as CollectionView,
    enabledViews: r.enabled_views as CollectionView[],
    showSummary: r.show_summary, showTags: r.show_tags, showNotes: r.show_notes,
    status: r.status as CollectionStatus, shareCode: r.share_code,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toItem(r: ItemRow): CollectionItem {
  return {
    id: r.id, collectionId: r.collection_id, position: r.position,
    kind: r.kind as CollectionItemKind, nodeId: r.node_id,
    caption: r.caption, textBody: r.text_body, createdAt: r.created_at,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await params;
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });

  const supabase = getAdminSupabase();
  const auth = await assertCollectionEditor(supabase, collectionId, session.userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data: cRow, error: cErr } = await supabase
    .from('collections').select(C_SELECT).eq('id', collectionId).single();
  if (cErr || !cRow) return NextResponse.json({ error: cErr?.message ?? 'not found' }, { status: 404 });

  const { data: itemRows, error: iErr } = await supabase
    .from('collection_items').select(ITEM_SELECT)
    .eq('collection_id', collectionId).order('position', { ascending: true });
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  const items = (itemRows ?? []).map(toItem);
  const nodeIds = items.map((i) => i.nodeId).filter((x): x is string => !!x);

  const nodesById: Record<string, NodeJoinRow> = {};
  if (nodeIds.length) {
    const { data: nodes, error: nErr } = await supabase
      .from('nodes').select(NODE_SELECT).in('id', nodeIds);
    if (nErr) return NextResponse.json({ error: nErr.message }, { status: 500 });
    for (const n of nodes ?? []) nodesById[(n as NodeJoinRow).id] = n as NodeJoinRow;
  }

  const { data: memberRows } = await supabase
    .from('collection_members').select('user_id, role, invited_by, created_at')
    .eq('collection_id', collectionId);

  return NextResponse.json({
    collection: toCollection(cRow as CollectionRow),
    isOwner: auth.isOwner,
    items: items.map((it) => ({
      ...it,
      node: it.nodeId ? nodesById[it.nodeId] ?? null : null,
    })),
    members: (memberRows ?? []),
  });
}

const ALLOWED_VIEWS: CollectionView[] = ['editorial', 'gallery', 'timeline'];

function sanitizeEnabledViews(input: unknown): CollectionView[] | null {
  if (!Array.isArray(input)) return null;
  const valid: CollectionView[] = [];
  for (const v of input) {
    if (typeof v === 'string' && (ALLOWED_VIEWS as string[]).includes(v) && !valid.includes(v as CollectionView)) {
      valid.push(v as CollectionView);
    }
  }
  if (!valid.includes('editorial')) valid.unshift('editorial'); // editorial is mandatory
  return valid;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await params;
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });

  const supabase = getAdminSupabase();
  const auth = await assertCollectionEditor(supabase, collectionId, session.userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.title === 'string') patch.title = body.title.trim().slice(0, 200) || 'Untitled Collection';
  if (typeof body.description === 'string' || body.description === null) patch.description = body.description ?? null;
  if (typeof body.coverPath === 'string' || body.coverPath === null) patch.cover_path = body.coverPath ?? null;
  if (typeof body.defaultView === 'string' && (ALLOWED_VIEWS as string[]).includes(body.defaultView)) {
    patch.default_view = body.defaultView;
  }
  if ('enabledViews' in body) {
    const ev = sanitizeEnabledViews(body.enabledViews);
    if (ev) patch.enabled_views = ev;
  }
  if (typeof body.showSummary === 'boolean') patch.show_summary = body.showSummary;
  if (typeof body.showTags === 'boolean') patch.show_tags = body.showTags;
  if (typeof body.showNotes === 'boolean') patch.show_notes = body.showNotes;

  const { data, error } = await supabase
    .from('collections').update(patch).eq('id', collectionId)
    .select(C_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ collection: toCollection(data as CollectionRow) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await params;
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });

  const supabase = getAdminSupabase();
  const auth = await assertCollectionOwner(supabase, collectionId, session.userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { error } = await supabase.from('collections').delete().eq('id', collectionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```
Expected: `Compiled successfully`. New route appears.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/collections/\[collectionId\]/route.ts
git commit -m "feat(api): GET/PATCH/DELETE /api/collections/[collectionId]"
```

---

### Task 7: API — add an item to a Collection

**Files:**
- Create: `src/app/api/collections/[collectionId]/items/route.ts`

`POST` adds either a capture (`kind: 'capture', nodeId`) or a text block (`kind: 'text', textBody`). For captures, runs the add-time `canAddCaptureToCollection` check.

- [ ] **Step 1: Implement**

Create `src/app/api/collections/[collectionId]/items/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { assertSession } from '@/lib/auth';
import { getAdminSupabase } from '@/lib/supabase-admin';
import { assertCollectionEditor } from '@/lib/collection-auth';
import { canAddCaptureToCollection } from '@/lib/collections';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await params;
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });

  const supabase = getAdminSupabase();
  const auth = await assertCollectionEditor(supabase, collectionId, session.userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as {
    kind?: string; nodeId?: string; textBody?: string; caption?: string;
  };
  if (body.kind !== 'capture' && body.kind !== 'text') {
    return NextResponse.json({ error: 'kind must be "capture" or "text"' }, { status: 400 });
  }

  if (body.kind === 'capture') {
    if (!body.nodeId || typeof body.nodeId !== 'string') {
      return NextResponse.json({ error: 'nodeId is required for capture items' }, { status: 400 });
    }

    const { data: node, error: nodeErr } = await supabase
      .from('nodes')
      .select('id, workspace_id, created_by')
      .eq('id', body.nodeId).maybeSingle();
    if (nodeErr) return NextResponse.json({ error: nodeErr.message }, { status: 500 });
    if (!node) return NextResponse.json({ error: 'Capture not found.' }, { status: 404 });

    // Caller must be a workspace member of the source Mind at add-time.
    const { data: memberRow } = await supabase
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', node.workspace_id)
      .eq('user_id', session.userId)
      .maybeSingle();
    if (!memberRow) {
      return NextResponse.json({ error: 'Not a member of the source Mind.' }, { status: 403 });
    }

    const { data: ws, error: wsErr } = await supabase
      .from('workspaces')
      .select('allow_member_cross_publish')
      .eq('id', node.workspace_id).single();
    if (wsErr || !ws) return NextResponse.json({ error: 'Source Mind not found.' }, { status: 404 });

    const decision = canAddCaptureToCollection({
      actorUserId: session.userId,
      nodeCreatedBy: node.created_by ?? session.userId,
      workspaceAllowMemberCrossPublish: ws.allow_member_cross_publish === true,
    });
    if (!decision.ok) {
      return NextResponse.json(
        { error: 'This Mind only allows adding your own captures to Collections.' },
        { status: 403 },
      );
    }
  } else {
    if (typeof body.textBody !== 'string' || body.textBody.trim().length === 0) {
      return NextResponse.json({ error: 'textBody is required for text items' }, { status: 400 });
    }
  }

  // Compute the next position (append).
  const { data: last } = await supabase
    .from('collection_items')
    .select('position')
    .eq('collection_id', collectionId)
    .order('position', { ascending: false })
    .limit(1).maybeSingle();
  const nextPosition = (last?.position ?? -1) + 1;

  const insertRow = {
    collection_id: collectionId,
    position: nextPosition,
    kind: body.kind,
    node_id: body.kind === 'capture' ? body.nodeId! : null,
    caption: body.kind === 'capture' && typeof body.caption === 'string'
      ? body.caption.slice(0, 2000) : null,
    text_body: body.kind === 'text' ? body.textBody!.slice(0, 10000) : null,
  };

  const { data, error } = await supabase
    .from('collection_items').insert(insertRow)
    .select('id, collection_id, position, kind, node_id, caption, text_body, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Touch parent timestamp.
  await supabase.from('collections')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', collectionId);

  return NextResponse.json({ item: data });
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```
Expected: Compiled successfully.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/collections/\[collectionId\]/items/route.ts
git commit -m "feat(api): POST /api/collections/[collectionId]/items (capture + text)"
```

---

### Task 8: API — patch / delete a single item

**Files:**
- Create: `src/app/api/collections/[collectionId]/items/[itemId]/route.ts`

`PATCH` accepts `{ caption?, textBody? }` updates (kind-appropriate fields ignored otherwise). `DELETE` removes one item and re-compacts neighbors.

- [ ] **Step 1: Implement**

Create `src/app/api/collections/[collectionId]/items/[itemId]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { assertSession } from '@/lib/auth';
import { getAdminSupabase } from '@/lib/supabase-admin';
import { assertCollectionEditor } from '@/lib/collection-auth';
import { compactPositions } from '@/lib/collections';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ collectionId: string; itemId: string }> },
) {
  const { collectionId, itemId } = await params;
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });

  const supabase = getAdminSupabase();
  const auth = await assertCollectionEditor(supabase, collectionId, session.userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data: existing } = await supabase
    .from('collection_items')
    .select('id, kind, collection_id')
    .eq('id', itemId)
    .maybeSingle();
  if (!existing || existing.collection_id !== collectionId) {
    return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    caption?: string | null;
    textBody?: string | null;
  };
  const patch: Record<string, unknown> = {};

  if ('caption' in body && existing.kind === 'capture') {
    patch.caption = typeof body.caption === 'string' ? body.caption.slice(0, 2000) : null;
  }
  if ('textBody' in body && existing.kind === 'text') {
    if (typeof body.textBody !== 'string' || body.textBody.trim().length === 0) {
      return NextResponse.json({ error: 'textBody cannot be empty' }, { status: 400 });
    }
    patch.text_body = body.textBody.slice(0, 10000);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const { data, error } = await supabase
    .from('collection_items').update(patch).eq('id', itemId)
    .select('id, collection_id, position, kind, node_id, caption, text_body, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('collections')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', collectionId);

  return NextResponse.json({ item: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ collectionId: string; itemId: string }> },
) {
  const { collectionId, itemId } = await params;
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });

  const supabase = getAdminSupabase();
  const auth = await assertCollectionEditor(supabase, collectionId, session.userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { error: delErr } = await supabase
    .from('collection_items').delete()
    .eq('id', itemId).eq('collection_id', collectionId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // Re-compact remaining positions.
  const { data: rest } = await supabase
    .from('collection_items')
    .select('id, position')
    .eq('collection_id', collectionId)
    .order('position', { ascending: true });

  const compacted = compactPositions((rest ?? []).map((r) => ({ id: r.id as string, position: r.position as number })));
  for (const c of compacted) {
    await supabase.from('collection_items').update({ position: c.position }).eq('id', c.id);
  }

  await supabase.from('collections')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', collectionId);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/collections/\[collectionId\]/items/\[itemId\]/route.ts
git commit -m "feat(api): PATCH/DELETE single Collection item"
```

---

### Task 9: API — bulk reorder items

**Files:**
- Modify: `src/app/api/collections/[collectionId]/items/route.ts` (add `PATCH`)

The editor's drag handler emits the new ordered list of item ids. The server normalizes via `compactPositions` and writes the new positions in one shot.

- [ ] **Step 1: Add the `PATCH` handler**

Append to `src/app/api/collections/[collectionId]/items/route.ts`:
```ts
import { compactPositions } from '@/lib/collections';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await params;
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });

  const supabase = getAdminSupabase();
  const auth = await assertCollectionEditor(supabase, collectionId, session.userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as { itemIds?: unknown };
  if (!Array.isArray(body.itemIds) || body.itemIds.some((x) => typeof x !== 'string')) {
    return NextResponse.json({ error: 'itemIds must be an array of strings' }, { status: 400 });
  }
  const itemIds = body.itemIds as string[];

  // Verify every id belongs to this collection (prevent cross-collection injection).
  const { data: existing, error: exErr } = await supabase
    .from('collection_items')
    .select('id')
    .eq('collection_id', collectionId);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  const existingIds = new Set((existing ?? []).map((r) => r.id as string));
  if (itemIds.length !== existingIds.size || !itemIds.every((id) => existingIds.has(id))) {
    return NextResponse.json({ error: 'itemIds must list every item in this Collection exactly once' }, { status: 400 });
  }

  const compacted = compactPositions(itemIds.map((id, i) => ({ id, position: i })));

  for (const c of compacted) {
    const { error } = await supabase.from('collection_items')
      .update({ position: c.position }).eq('id', c.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from('collections')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', collectionId);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/collections/\[collectionId\]/items/route.ts
git commit -m "feat(api): PATCH /api/collections/[collectionId]/items — bulk reorder"
```

---

### Task 10: API — editor invites

**Files:**
- Create: `src/app/api/collections/[collectionId]/members/route.ts`

Owner-only. `GET` lists current editors. `POST` invites by email (looks up the user; 404 if no account; 409 if already an editor). `DELETE` revokes (body carries `userId`).

- [ ] **Step 1: Implement**

Create `src/app/api/collections/[collectionId]/members/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { assertSession } from '@/lib/auth';
import { getAdminSupabase } from '@/lib/supabase-admin';
import { assertCollectionOwner } from '@/lib/collection-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await params;
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });

  const supabase = getAdminSupabase();
  const auth = await assertCollectionOwner(supabase, collectionId, session.userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data, error } = await supabase
    .from('collection_members')
    .select('user_id, role, invited_by, created_at')
    .eq('collection_id', collectionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ members: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await params;
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });

  const supabase = getAdminSupabase();
  const auth = await assertCollectionOwner(supabase, collectionId, session.userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as { email?: string };
  if (typeof body.email !== 'string' || !body.email.includes('@')) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }
  const email = body.email.trim().toLowerCase();

  const { data: user } = await supabase
    .from('users').select('id').eq('email', email).maybeSingle();
  if (!user) return NextResponse.json({ error: 'No MuttMind account for that email.' }, { status: 404 });
  if (user.id === session.userId) {
    return NextResponse.json({ error: 'You are already the owner.' }, { status: 409 });
  }

  const { error: insErr } = await supabase
    .from('collection_members')
    .insert({
      collection_id: collectionId,
      user_id: user.id,
      role: 'editor',
      invited_by: session.userId,
    });
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Already an editor.' }, { status: 409 });
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await params;
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });

  const supabase = getAdminSupabase();
  const auth = await assertCollectionOwner(supabase, collectionId, session.userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as { userId?: string };
  if (typeof body.userId !== 'string') {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  const { error } = await supabase
    .from('collection_members').delete()
    .eq('collection_id', collectionId).eq('user_id', body.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

> If the users table is not `public.users` in this repo (Task 1 noted the same caveat), substitute the actual table name. The lookup pattern stays the same.

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/collections/\[collectionId\]/members/route.ts
git commit -m "feat(api): collection editor invites (owner-only)"
```

---

### Task 11: API — Mind cross-publish toggle

**Files:**
- Create: `src/app/api/workspaces/[workspaceId]/cross-publish/route.ts`

Owner-only PATCH that sets `workspaces.allow_member_cross_publish`. Surfaces in Mind settings (Task 25).

- [ ] **Step 1: Read existing workspace-auth pattern**

Read `src/lib/auth.ts` for `assertWorkspaceOwner` (if it exists) or the equivalent. If only `assertWorkspaceMember` exists, write a thin inline owner check using `workspaces.owner_user_id`.

- [ ] **Step 2: Implement**

Create `src/app/api/workspaces/[workspaceId]/cross-publish/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { assertSession } from '@/lib/auth';
import { getAdminSupabase } from '@/lib/supabase-admin';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  const session = await assertSession(req);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });

  const supabase = getAdminSupabase();
  const { data: ws } = await supabase
    .from('workspaces').select('owner_user_id').eq('id', workspaceId).maybeSingle();
  if (!ws) return NextResponse.json({ error: 'Mind not found.' }, { status: 404 });
  if (ws.owner_user_id !== session.userId) {
    return NextResponse.json({ error: 'Owner-only.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { allow?: unknown };
  if (typeof body.allow !== 'boolean') {
    return NextResponse.json({ error: 'allow must be boolean' }, { status: 400 });
  }

  const { error } = await supabase
    .from('workspaces')
    .update({ allow_member_cross_publish: body.allow })
    .eq('id', workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, allowMemberCrossPublish: body.allow });
}
```

> If `workspaces.owner_user_id` doesn't exist under that name, check `src/app/api/workspaces/.../route.ts` for the actual ownership column and adjust.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/workspaces/\[workspaceId\]/cross-publish/route.ts
git commit -m "feat(api): PATCH workspaces/[id]/cross-publish (Shared-Mind opt-in)"
```

---

### Task 12: AppNav — add Collections link

**Files:**
- Modify: `src/components/AppNav.tsx`

- [ ] **Step 1: Read AppNav**

Read `src/components/AppNav.tsx`. Identify the section that renders the authed nav links (next to the brand / search). Find where existing links are listed.

- [ ] **Step 2: Insert the Collections link**

Add a `<Link href="/collections">Collections</Link>` (or the equivalent of the existing pattern — match how other links are rendered, including any active-state styling). Place it after the search link, before the user menu.

> If AppNav uses an array-of-objects to render links, append `{ href: '/collections', label: 'Collections' }` instead of inlining JSX.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/AppNav.tsx
git commit -m "feat(nav): add Collections link to AppNav"
```

---

### Task 13: Collections home page

**Files:**
- Create: `src/app/collections/page.tsx`
- Create: `src/app/collections/CollectionsHome.tsx`

Top-level home grid. Server component does the session bootstrap, client component fetches `/api/collections`, renders owned + invited Collections, and offers "New Collection."

- [ ] **Step 1: Server entry**

Create `src/app/collections/page.tsx`:
```tsx
import CollectionsHome from './CollectionsHome';

export const metadata = { title: 'Collections — MuttMind' };

export default function CollectionsPage() {
  return <CollectionsHome />;
}
```

- [ ] **Step 2: Client home**

Create `src/app/collections/CollectionsHome.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Collection } from '@/lib/collections';
// Use whatever authedFetch helper is used elsewhere in the app:
import { authedFetch } from '@/lib/client-fetch';

export default function CollectionsHome() {
  const router = useRouter();
  const [owned, setOwned] = useState<Collection[]>([]);
  const [invited, setInvited] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await authedFetch('/api/collections');
      if (!r.ok) {
        setError((await r.json()).error ?? 'Failed to load.');
        setLoading(false);
        return;
      }
      const d = await r.json();
      setOwned(d.owned ?? []);
      setInvited(d.invited ?? []);
      setLoading(false);
    })();
  }, []);

  const createNew = async () => {
    setCreating(true);
    const r = await authedFetch('/api/collections', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setCreating(false);
    if (!r.ok) {
      setError((await r.json()).error ?? 'Could not create.');
      return;
    }
    const d = await r.json();
    router.push(`/collections/${d.collection.id}`);
  };

  return (
    <main className="ms-page">
      <header className="ms-page__header">
        <h1>Collections</h1>
        <button className="ms-btn ms-btn--primary" onClick={createNew} disabled={creating}>
          {creating ? 'Creating…' : 'New Collection'}
        </button>
      </header>

      {loading && <p className="meta">Loading…</p>}
      {error && <p className="meta meta--error">{error}</p>}

      {!loading && owned.length === 0 && invited.length === 0 && (
        <p className="meta">No Collections yet. Start one to compose an authored thread from your captures.</p>
      )}

      {owned.length > 0 && (
        <section>
          <h2 className="ms-section-heading">Yours</h2>
          <CollectionGrid items={owned} />
        </section>
      )}

      {invited.length > 0 && (
        <section>
          <h2 className="ms-section-heading">Shared with you</h2>
          <CollectionGrid items={invited} />
        </section>
      )}
    </main>
  );
}

function CollectionGrid({ items }: { items: Collection[] }) {
  return (
    <ul className="ms-grid ms-grid--cards">
      {items.map((c) => (
        <li key={c.id}>
          <Link href={`/collections/${c.id}`} className="ms-card">
            <div className="ms-card__title">{c.title}</div>
            {c.description && <div className="ms-card__desc">{c.description}</div>}
            <div className="meta">{c.status === 'published' ? 'Published' : 'Draft'}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

> If `@/lib/client-fetch` isn't the right import path for the existing `authedFetch` (check Mind board page imports), adjust. Same for the `ms-*` class names — match the codebase rather than introducing new ones if any of these don't exist.

- [ ] **Step 3: Verify build**

```bash
npm run build
```
Expected: Compiled successfully, `/collections` route appears.

- [ ] **Step 4: Commit**

```bash
git add src/app/collections/page.tsx src/app/collections/CollectionsHome.tsx
git commit -m "feat(ui): /collections home — grid of owned + invited Collections + new"
```

---

### Task 14: Editor — server entry + client skeleton (header + metadata)

**Files:**
- Create: `src/app/collections/[collectionId]/page.tsx`
- Create: `src/app/collections/[collectionId]/CollectionEditor.tsx`

Skeleton of the editor: title, description, status pill, save button — bound to the PATCH route from Task 6. Item list and lower sections come in subsequent tasks.

- [ ] **Step 1: Server entry**

Create `src/app/collections/[collectionId]/page.tsx`:
```tsx
import CollectionEditor from './CollectionEditor';

export default async function CollectionEditorPage({
  params,
}: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params;
  return <CollectionEditor collectionId={collectionId} />;
}
```

- [ ] **Step 2: Editor client skeleton**

Create `src/app/collections/[collectionId]/CollectionEditor.tsx`:
```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { authedFetch } from '@/lib/client-fetch';
import type { Collection, CollectionItem } from '@/lib/collections';

interface ItemWithNode extends CollectionItem {
  node: {
    id: string; title: string | null; original_url: string | null;
    og_image: string | null; media_path: string | null; scrape_kind: string | null;
    published_at: string | null; created_at: string; created_by: string | null;
    workspace_id: string;
  } | null;
}

export default function CollectionEditor({ collectionId }: { collectionId: string }) {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<ItemWithNode[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  const load = useCallback(async () => {
    const r = await authedFetch(`/api/collections/${collectionId}`);
    if (!r.ok) {
      setStatus((await r.json()).error ?? 'Failed to load.');
      setLoading(false);
      return;
    }
    const d = await r.json();
    setCollection(d.collection);
    setItems(d.items ?? []);
    setIsOwner(!!d.isOwner);
    setTitleDraft(d.collection.title);
    setDescDraft(d.collection.description ?? '');
    setLoading(false);
  }, [collectionId]);

  useEffect(() => { load(); }, [load]);

  const saveMeta = async () => {
    if (!collection) return;
    setSavingMeta(true);
    const r = await authedFetch(`/api/collections/${collectionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: titleDraft, description: descDraft || null }),
    });
    setSavingMeta(false);
    if (!r.ok) {
      setStatus((await r.json()).error ?? 'Could not save.');
      return;
    }
    const d = await r.json();
    setCollection(d.collection);
    setStatus('Saved.');
  };

  if (loading) return <main className="ms-page"><p className="meta">Loading…</p></main>;
  if (!collection) return <main className="ms-page"><p className="meta meta--error">{status ?? 'Not found.'}</p></main>;

  return (
    <main className="ms-page">
      <header className="ms-page__header">
        <input
          className="ms-input ms-input--title"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          placeholder="Untitled Collection"
        />
        <button className="ms-btn" onClick={saveMeta} disabled={savingMeta}>
          {savingMeta ? 'Saving…' : 'Save'}
        </button>
      </header>

      <div className="ms-field">
        <label className="ms-field__label">Description</label>
        <textarea
          className="ms-input"
          rows={3}
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          placeholder="Short intro that sets up the Collection…"
        />
      </div>

      <div className="meta">
        Status: {collection.status === 'published' ? 'Published' : 'Draft'}
        {' · '}Editor role: {isOwner ? 'Owner' : 'Editor'}
      </div>

      {status && <p className="meta">{status}</p>}

      {/* Item list rendered in Task 15. */}
      <section data-section="items" />
    </main>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/collections/\[collectionId\]
git commit -m "feat(ui): Collection editor skeleton — title/description/save"
```

---

### Task 15: Editor — Editorial list rendering

**Files:**
- Modify: `src/app/collections/[collectionId]/CollectionEditor.tsx`

Replace the `<section data-section="items" />` placeholder with the actual Editorial item list. Capture items: thumbnail (use `og_image` or a placeholder), title (linking to the source `original_url` if present), and a placeholder caption row (Task 18 wires the edit). Text items: a `<pre>` rendering `text_body` (whitespace preserved). Each item gets a "Remove" button hooked to the DELETE route (Task 8).

- [ ] **Step 1: Add a helper to fetch the latest items after a write**

Inside `CollectionEditor.tsx`, the existing `load()` already does this. Wire a `removeItem` handler:

Add inside the component (above the `return`):
```tsx
const removeItem = async (itemId: string) => {
  if (!confirm('Remove this item from the Collection?')) return;
  const r = await authedFetch(`/api/collections/${collectionId}/items/${itemId}`, {
    method: 'DELETE',
  });
  if (!r.ok) {
    setStatus((await r.json()).error ?? 'Could not remove.');
    return;
  }
  setItems((prev) => prev.filter((it) => it.id !== itemId));
  setStatus('Removed.');
};
```

- [ ] **Step 2: Render the list**

Replace the `<section data-section="items" />` line with:
```tsx
<section className="ms-collection-items">
  {items.length === 0 && (
    <p className="meta">
      No items yet. Open a capture in any Mind and choose "Add to Collection," or use board multi-select.
    </p>
  )}
  <ol className="ms-collection-items__list">
    {items.map((it) => (
      <li key={it.id} className={`ms-collection-item ms-collection-item--${it.kind}`}>
        {it.kind === 'capture' && (
          <CaptureItemView
            item={it}
            onRemove={() => removeItem(it.id)}
          />
        )}
        {it.kind === 'text' && (
          <TextBlockView
            item={it}
            onRemove={() => removeItem(it.id)}
          />
        )}
      </li>
    ))}
  </ol>
</section>
```

- [ ] **Step 3: Add the two presentational subcomponents**

At the bottom of the same file (outside the default export):
```tsx
function CaptureItemView({
  item,
  onRemove,
}: { item: ItemWithNode; onRemove: () => void }) {
  const node = item.node;
  if (!node) {
    return (
      <div className="ms-collection-item__body">
        <div className="meta meta--error">(removed — keep or delete)</div>
        <button className="ms-btn ms-btn--ghost" onClick={onRemove}>Remove</button>
      </div>
    );
  }
  return (
    <div className="ms-collection-item__body">
      {node.og_image && (
        <img src={node.og_image} alt="" className="ms-collection-item__thumb" />
      )}
      <div className="ms-collection-item__text">
        <div className="ms-collection-item__title">
          {node.original_url ? (
            <a href={node.original_url} target="_blank" rel="noreferrer">
              {node.title ?? 'Untitled capture'}
            </a>
          ) : (
            <span>{node.title ?? 'Untitled capture'}</span>
          )}
        </div>
        {item.caption && (
          <div className="ms-collection-item__caption" style={{ whiteSpace: 'pre-wrap' }}>
            {item.caption}
          </div>
        )}
        <div className="meta">
          <button className="ms-btn ms-btn--ghost" onClick={onRemove}>Remove</button>
        </div>
      </div>
    </div>
  );
}

function TextBlockView({
  item,
  onRemove,
}: { item: ItemWithNode; onRemove: () => void }) {
  return (
    <div className="ms-collection-item__body">
      <div className="ms-collection-item__textblock" style={{ whiteSpace: 'pre-wrap' }}>
        {item.textBody}
      </div>
      <button className="ms-btn ms-btn--ghost" onClick={onRemove}>Remove</button>
    </div>
  );
}
```

> The `ms-collection-*` class names are new — add minimal CSS in whichever global stylesheet the codebase uses for the `ms-*` family. If you can't find that file, leave the classes in place (HTML still renders) and capture this as a follow-up; the layout will be unstyled but functional.

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/app/collections/\[collectionId\]/CollectionEditor.tsx
git commit -m "feat(ui): editorial item list rendering with remove"
```

---

### Task 16: Editor — drag-to-reorder

**Files:**
- Modify: `package.json` (+ lockfile)
- Modify: `src/app/collections/[collectionId]/CollectionEditor.tsx`

- [ ] **Step 1: Install drag library**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Wrap the list with a DnD context**

Replace the `<ol>…</ol>` block from Task 15 with the SortableContext version:
```tsx
import {
  DndContext, DragEndEvent, PointerSensor,
  closestCenter, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// …inside the component:

const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

const handleDragEnd = async (e: DragEndEvent) => {
  if (!e.over || e.active.id === e.over.id) return;
  const oldIndex = items.findIndex((i) => i.id === e.active.id);
  const newIndex = items.findIndex((i) => i.id === e.over!.id);
  if (oldIndex < 0 || newIndex < 0) return;
  const next = arrayMove(items, oldIndex, newIndex);
  setItems(next); // optimistic
  const r = await authedFetch(`/api/collections/${collectionId}/items`, {
    method: 'PATCH',
    body: JSON.stringify({ itemIds: next.map((i) => i.id) }),
  });
  if (!r.ok) {
    setStatus((await r.json()).error ?? 'Could not reorder.');
    setItems(items); // revert
  }
};

// …replace the list:
<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
  <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
    <ol className="ms-collection-items__list">
      {items.map((it) => (
        <SortableRow key={it.id} id={it.id}>
          {it.kind === 'capture'
            ? <CaptureItemView item={it} onRemove={() => removeItem(it.id)} />
            : <TextBlockView item={it} onRemove={() => removeItem(it.id)} />}
        </SortableRow>
      ))}
    </ol>
  </SortableContext>
</DndContext>
```

- [ ] **Step 3: Add the `SortableRow` wrapper**

Bottom of the file:
```tsx
function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="ms-collection-item ms-collection-item--draggable"
    >
      <button
        className="ms-collection-item__handle"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <div className="ms-collection-item__rowbody">{children}</div>
    </li>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/app/collections/\[collectionId\]/CollectionEditor.tsx
git commit -m "feat(ui): drag-to-reorder Collection items (@dnd-kit)"
```

---

### Task 17: Editor — add text blocks

**Files:**
- Modify: `src/app/collections/[collectionId]/CollectionEditor.tsx`

Add an "Add text block" button at the bottom of the list that opens an inline textarea + Save. On save, POST to `/api/collections/:id/items` with `{ kind: 'text', textBody }`, then refresh items.

- [ ] **Step 1: Add state + handler**

Inside `CollectionEditor`:
```tsx
const [textDraft, setTextDraft] = useState('');
const [addingText, setAddingText] = useState(false);
const [textBusy, setTextBusy] = useState(false);

const addTextBlock = async () => {
  if (textDraft.trim().length === 0) return;
  setTextBusy(true);
  const r = await authedFetch(`/api/collections/${collectionId}/items`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'text', textBody: textDraft }),
  });
  setTextBusy(false);
  if (!r.ok) {
    setStatus((await r.json()).error ?? 'Could not add.');
    return;
  }
  setTextDraft('');
  setAddingText(false);
  await load();
};
```

- [ ] **Step 2: Render the affordance**

After the `</DndContext>` closing tag, add:
```tsx
<div className="ms-collection-add">
  {!addingText && (
    <button className="ms-btn" onClick={() => setAddingText(true)}>
      + Add text block
    </button>
  )}
  {addingText && (
    <div className="ms-field">
      <textarea
        className="ms-input"
        rows={4}
        value={textDraft}
        onChange={(e) => setTextDraft(e.target.value)}
        placeholder="Heading, intro, or connective prose between items…"
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ms-btn" onClick={addTextBlock} disabled={textBusy}>
          {textBusy ? 'Adding…' : 'Save block'}
        </button>
        <button className="ms-btn ms-btn--ghost" onClick={() => { setAddingText(false); setTextDraft(''); }}>
          Cancel
        </button>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/collections/\[collectionId\]/CollectionEditor.tsx
git commit -m "feat(ui): add text blocks to a Collection"
```

---

### Task 18: Editor — per-item caption editing

**Files:**
- Modify: `src/app/collections/[collectionId]/CollectionEditor.tsx`

The caption is currently a read-only div. Make it editable: an "Edit caption" toggle reveals a textarea + Save that PATCHes the item.

- [ ] **Step 1: Track edit state per item**

Inside `CollectionEditor`:
```tsx
const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
const [captionDraft, setCaptionDraft] = useState('');
const [captionBusy, setCaptionBusy] = useState(false);

const startEditCaption = (item: ItemWithNode) => {
  setEditingCaptionId(item.id);
  setCaptionDraft(item.caption ?? '');
};

const saveCaption = async (itemId: string) => {
  setCaptionBusy(true);
  const r = await authedFetch(`/api/collections/${collectionId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ caption: captionDraft || null }),
  });
  setCaptionBusy(false);
  if (!r.ok) {
    setStatus((await r.json()).error ?? 'Could not save caption.');
    return;
  }
  setItems((prev) => prev.map((it) => it.id === itemId ? { ...it, caption: captionDraft || null } : it));
  setEditingCaptionId(null);
  setStatus('Caption saved.');
};
```

- [ ] **Step 2: Wire into `CaptureItemView`**

Change the `CaptureItemView` props and body. Replace the existing function with:
```tsx
function CaptureItemView({
  item,
  isEditingCaption,
  captionDraft,
  setCaptionDraft,
  startEditCaption,
  saveCaption,
  cancelCaption,
  captionBusy,
  onRemove,
}: {
  item: ItemWithNode;
  isEditingCaption: boolean;
  captionDraft: string;
  setCaptionDraft: (v: string) => void;
  startEditCaption: (it: ItemWithNode) => void;
  saveCaption: (id: string) => void;
  cancelCaption: () => void;
  captionBusy: boolean;
  onRemove: () => void;
}) {
  const node = item.node;
  if (!node) {
    return (
      <div className="ms-collection-item__body">
        <div className="meta meta--error">(removed — keep or delete)</div>
        <button className="ms-btn ms-btn--ghost" onClick={onRemove}>Remove</button>
      </div>
    );
  }
  return (
    <div className="ms-collection-item__body">
      {node.og_image && (
        <img src={node.og_image} alt="" className="ms-collection-item__thumb" />
      )}
      <div className="ms-collection-item__text">
        <div className="ms-collection-item__title">
          {node.original_url ? (
            <a href={node.original_url} target="_blank" rel="noreferrer">
              {node.title ?? 'Untitled capture'}
            </a>
          ) : (
            <span>{node.title ?? 'Untitled capture'}</span>
          )}
        </div>

        {isEditingCaption ? (
          <div className="ms-field">
            <textarea
              className="ms-input"
              rows={3}
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              placeholder="Why this item belongs here, in this place…"
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="ms-btn" onClick={() => saveCaption(item.id)} disabled={captionBusy}>
                {captionBusy ? 'Saving…' : 'Save caption'}
              </button>
              <button className="ms-btn ms-btn--ghost" onClick={cancelCaption}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {item.caption ? (
              <div className="ms-collection-item__caption" style={{ whiteSpace: 'pre-wrap' }}>
                {item.caption}
              </div>
            ) : (
              <div className="meta">No caption yet.</div>
            )}
            <div className="meta">
              <button className="ms-btn ms-btn--ghost" onClick={() => startEditCaption(item)}>
                Edit caption
              </button>
              {' · '}
              <button className="ms-btn ms-btn--ghost" onClick={onRemove}>Remove</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Pass new props in the SortableRow rendering**

Update the JSX where `CaptureItemView` is rendered:
```tsx
{it.kind === 'capture' && (
  <CaptureItemView
    item={it}
    isEditingCaption={editingCaptionId === it.id}
    captionDraft={captionDraft}
    setCaptionDraft={setCaptionDraft}
    startEditCaption={startEditCaption}
    saveCaption={saveCaption}
    cancelCaption={() => setEditingCaptionId(null)}
    captionBusy={captionBusy}
    onRemove={() => removeItem(it.id)}
  />
)}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/app/collections/\[collectionId\]/CollectionEditor.tsx
git commit -m "feat(ui): per-item caption editing"
```

---

### Task 19: Editor — cover image picker

**Files:**
- Modify: `src/app/collections/[collectionId]/CollectionEditor.tsx`

Add a "Cover" section to the header area. Two affordances: (a) "Choose from items" — opens a picker listing every item's `og_image` / `media_path`; selecting one sets `coverPath` via PATCH. (b) "Upload" — reuses the existing direct-to-storage upload flow used elsewhere in the app (find it in `src/app/minds/[id]/page.tsx` or the capture pipeline) and sets `cover_path` to the resulting key.

- [ ] **Step 1: Add state + helpers**

Inside `CollectionEditor`:
```tsx
const [coverPickerOpen, setCoverPickerOpen] = useState(false);
const [coverBusy, setCoverBusy] = useState(false);

const setCover = async (path: string | null) => {
  setCoverBusy(true);
  const r = await authedFetch(`/api/collections/${collectionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ coverPath: path }),
  });
  setCoverBusy(false);
  if (!r.ok) {
    setStatus((await r.json()).error ?? 'Could not set cover.');
    return;
  }
  const d = await r.json();
  setCollection(d.collection);
  setCoverPickerOpen(false);
  setStatus('Cover updated.');
};
```

- [ ] **Step 2: Render the affordance under the description field**

```tsx
<div className="ms-field">
  <label className="ms-field__label">Cover</label>
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    {collection.coverPath ? (
      <div className="ms-cover-thumb meta">{collection.coverPath}</div>
    ) : (
      <div className="meta">No cover.</div>
    )}
    <button className="ms-btn ms-btn--ghost" onClick={() => setCoverPickerOpen(true)} disabled={coverBusy}>
      {collection.coverPath ? 'Change' : 'Set cover'}
    </button>
    {collection.coverPath && (
      <button className="ms-btn ms-btn--ghost" onClick={() => setCover(null)} disabled={coverBusy}>
        Clear
      </button>
    )}
  </div>
  {coverPickerOpen && (
    <div className="ms-cover-picker">
      <p className="meta">Pick from a capture image, or paste a storage path:</p>
      <div className="ms-cover-picker__grid">
        {items.flatMap((it) => {
          const opts: string[] = [];
          if (it.node?.og_image) opts.push(it.node.og_image);
          if (it.node?.media_path) opts.push(it.node.media_path);
          return opts.map((path) => (
            <button
              key={`${it.id}-${path}`}
              className="ms-cover-picker__cell"
              onClick={() => setCover(path)}
              disabled={coverBusy}
            >
              <img src={path} alt="" />
            </button>
          ));
        })}
      </div>
      <button className="ms-btn ms-btn--ghost" onClick={() => setCoverPickerOpen(false)}>Cancel</button>
    </div>
  )}
</div>
```

> Direct-to-storage upload reuse: if it's straightforward to wire (one extra "Upload new" button that opens the existing file picker and calls the existing `prepareUpload`/`from-storage` flow), do it; if it's a bigger lift, ship picker-from-items in this task and defer the upload entry as a single-line follow-up — the cover_path column already accepts any storage key.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/collections/\[collectionId\]/CollectionEditor.tsx
git commit -m "feat(ui): Collection cover picker (from item images)"
```

---

### Task 20: Editor — manage editors (owner-only)

**Files:**
- Modify: `src/app/collections/[collectionId]/CollectionEditor.tsx`

Below the cover field, if `isOwner`, render a "Editors" section showing the current member list and a small form to invite by email (POST to `/api/collections/:id/members`). Members can be revoked (DELETE).

- [ ] **Step 1: Track editor state**

```tsx
const [members, setMembers] = useState<{ user_id: string; role: string; created_at: string }[]>([]);
const [inviteEmail, setInviteEmail] = useState('');
const [inviteBusy, setInviteBusy] = useState(false);

const loadMembers = useCallback(async () => {
  if (!isOwner) return;
  const r = await authedFetch(`/api/collections/${collectionId}/members`);
  if (!r.ok) return;
  const d = await r.json();
  setMembers(d.members ?? []);
}, [collectionId, isOwner]);

useEffect(() => { loadMembers(); }, [loadMembers]);

const invite = async () => {
  setInviteBusy(true);
  const r = await authedFetch(`/api/collections/${collectionId}/members`, {
    method: 'POST',
    body: JSON.stringify({ email: inviteEmail }),
  });
  setInviteBusy(false);
  if (!r.ok) {
    setStatus((await r.json()).error ?? 'Could not invite.');
    return;
  }
  setInviteEmail('');
  setStatus('Editor invited.');
  await loadMembers();
};

const revoke = async (userId: string) => {
  if (!confirm('Remove this editor?')) return;
  const r = await authedFetch(`/api/collections/${collectionId}/members`, {
    method: 'DELETE',
    body: JSON.stringify({ userId }),
  });
  if (!r.ok) {
    setStatus((await r.json()).error ?? 'Could not revoke.');
    return;
  }
  setMembers((prev) => prev.filter((m) => m.user_id !== userId));
};
```

- [ ] **Step 2: Render the section**

```tsx
{isOwner && (
  <div className="ms-field">
    <label className="ms-field__label">Editors</label>
    {members.length === 0 ? (
      <p className="meta">No co-editors yet.</p>
    ) : (
      <ul>
        {members.map((m) => (
          <li key={m.user_id} className="meta">
            {m.user_id}{' '}
            <button className="ms-btn ms-btn--ghost" onClick={() => revoke(m.user_id)}>Remove</button>
          </li>
        ))}
      </ul>
    )}
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <input
        className="ms-input"
        type="email"
        value={inviteEmail}
        onChange={(e) => setInviteEmail(e.target.value)}
        placeholder="invite by email"
      />
      <button className="ms-btn" onClick={invite} disabled={inviteBusy || !inviteEmail}>
        {inviteBusy ? 'Inviting…' : 'Invite'}
      </button>
    </div>
  </div>
)}
```

> Showing raw user ids isn't great UX, but is sufficient for v1; the user-display-name lookup is a polish follow-up.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/collections/\[collectionId\]/CollectionEditor.tsx
git commit -m "feat(ui): owner-only editor invites in Collection editor"
```

---

### Task 21: AddToCollection picker component

**Files:**
- Create: `src/components/AddToCollection.tsx`

A reusable modal/popover that lists the user's collections and lets them pick one (or create a new one inline). Returns the chosen `collectionId` to the parent, which calls the Add API with the right `nodeId`(s).

- [ ] **Step 1: Implement**

Create `src/components/AddToCollection.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { authedFetch } from '@/lib/client-fetch';
import type { Collection } from '@/lib/collections';

export interface AddToCollectionProps {
  open: boolean;
  onClose: () => void;
  /** Called with the picked collection id and (for transparency) its title. */
  onPick: (collectionId: string, title: string) => void;
}

export default function AddToCollection({ open, onClose, onPick }: AddToCollectionProps) {
  const [owned, setOwned] = useState<Collection[]>([]);
  const [invited, setInvited] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    (async () => {
      const r = await authedFetch('/api/collections');
      if (!r.ok) {
        setError((await r.json()).error ?? 'Failed to load.');
        setLoading(false);
        return;
      }
      const d = await r.json();
      setOwned(d.owned ?? []);
      setInvited(d.invited ?? []);
      setLoading(false);
    })();
  }, [open]);

  if (!open) return null;

  const createNew = async () => {
    setCreating(true);
    const r = await authedFetch('/api/collections', { method: 'POST', body: JSON.stringify({}) });
    setCreating(false);
    if (!r.ok) {
      setError((await r.json()).error ?? 'Could not create.');
      return;
    }
    const d = await r.json();
    onPick(d.collection.id, d.collection.title);
  };

  return (
    <div className="ms-modal" role="dialog" aria-label="Add to Collection">
      <div className="ms-modal__panel">
        <header className="ms-modal__header">
          <h3>Add to Collection</h3>
          <button className="ms-btn ms-btn--ghost" onClick={onClose}>Close</button>
        </header>

        {loading && <p className="meta">Loading…</p>}
        {error && <p className="meta meta--error">{error}</p>}

        {!loading && (
          <>
            <div className="ms-field">
              <button className="ms-btn ms-btn--primary" onClick={createNew} disabled={creating}>
                {creating ? 'Creating…' : '+ New Collection'}
              </button>
            </div>

            {owned.length > 0 && (
              <>
                <h4 className="ms-section-heading">Yours</h4>
                <ul>
                  {owned.map((c) => (
                    <li key={c.id}>
                      <button className="ms-btn ms-btn--ghost" onClick={() => onPick(c.id, c.title)}>
                        {c.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {invited.length > 0 && (
              <>
                <h4 className="ms-section-heading">Shared with you</h4>
                <ul>
                  {invited.map((c) => (
                    <li key={c.id}>
                      <button className="ms-btn ms-btn--ghost" onClick={() => onPick(c.id, c.title)}>
                        {c.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/AddToCollection.tsx
git commit -m "feat(ui): AddToCollection picker component"
```

---

### Task 22: Drawer entry point — Add to Collection

**Files:**
- Modify: `src/app/minds/[id]/page.tsx`

In the capture drawer, add an "Add to Collection ↗" button near the other capture actions. Opens the `AddToCollection` modal; on pick, POSTs to `/api/collections/<id>/items` with `{ kind: 'capture', nodeId: selectedCapture.id }` and shows success/failure in the existing `status` channel.

- [ ] **Step 1: Wire state**

Near other `useState`s in the Board component:
```tsx
const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
const [addToCollectionBusy, setAddToCollectionBusy] = useState(false);

const handleAddSelectedToCollection = async (collectionId: string, title: string) => {
  if (!selectedCapture) return;
  setAddToCollectionBusy(true);
  const r = await authedFetch(`/api/collections/${collectionId}/items`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'capture', nodeId: selectedCapture.id }),
  });
  setAddToCollectionBusy(false);
  setAddToCollectionOpen(false);
  if (!r.ok) {
    setStatus((await r.json()).error ?? 'Could not add to Collection.');
    return;
  }
  setStatus(`Added to "${title}".`);
};
```

- [ ] **Step 2: Render the button in the drawer**

Near the other drawer action buttons (find the Save/Reprocess/Delete cluster), add:
```tsx
<button
  className="ms-btn"
  onClick={() => setAddToCollectionOpen(true)}
  disabled={addToCollectionBusy}
>
  Add to Collection ↗
</button>
```

- [ ] **Step 3: Mount the modal**

At the bottom of the Board component's JSX (alongside the drawer):
```tsx
<AddToCollection
  open={addToCollectionOpen}
  onClose={() => setAddToCollectionOpen(false)}
  onPick={handleAddSelectedToCollection}
/>
```

And at the top of the file:
```tsx
import AddToCollection from '@/components/AddToCollection';
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add "src/app/minds/[id]/page.tsx"
git commit -m "feat(drawer): Add to Collection action"
```

---

### Task 23: Board multi-select entry point

**Files:**
- Modify: `src/app/minds/[id]/page.tsx`

The board already has a multi-select pattern (check the code for `selectedIds` or similar). Add a "Add N to Collection" button that appears when the selection is non-empty; opens the picker; loops over selected ids and POSTs each. Reports `K of N added` or any single-add failures.

- [ ] **Step 1: Find the existing multi-select state**

Search the file for `selectedIds`, `multiSelect`, or `bulkAction`. Identify the state and the existing toolbar that hosts bulk actions. If no multi-select exists in the current Board, **defer this task to a follow-up** and note it in the commit; the drawer entry alone is sufficient for the v1 acceptance criterion. If multi-select does exist, proceed.

- [ ] **Step 2: Wire the bulk add**

```tsx
const [bulkAddBusy, setBulkAddBusy] = useState(false);
const [bulkAddOpen, setBulkAddOpen] = useState(false);

const handleBulkAddToCollection = async (collectionId: string, title: string) => {
  if (selectedIds.size === 0) return; // adapt the variable name to the actual state
  setBulkAddBusy(true);
  let added = 0;
  const failures: string[] = [];
  for (const nodeId of selectedIds) {
    const r = await authedFetch(`/api/collections/${collectionId}/items`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'capture', nodeId }),
    });
    if (r.ok) added += 1;
    else failures.push(((await r.json()) as { error?: string }).error ?? 'unknown');
  }
  setBulkAddBusy(false);
  setBulkAddOpen(false);
  setStatus(failures.length
    ? `Added ${added} of ${selectedIds.size} to "${title}". ${failures.length} failed.`
    : `Added ${added} to "${title}".`);
};
```

- [ ] **Step 3: Render the button in the bulk toolbar**

```tsx
{selectedIds.size > 0 && (
  <button className="ms-btn" onClick={() => setBulkAddOpen(true)} disabled={bulkAddBusy}>
    Add {selectedIds.size} to Collection
  </button>
)}
<AddToCollection
  open={bulkAddOpen}
  onClose={() => setBulkAddOpen(false)}
  onPick={handleBulkAddToCollection}
/>
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add "src/app/minds/[id]/page.tsx"
git commit -m "feat(board): Add N selected captures to a Collection"
```

---

### Task 24: Search results entry point

**Files:**
- Modify: `src/app/search/page.tsx` (or wherever search renders its row results)

For each capture result row (not insight rows), add an "Add to Collection" affordance. Disabled on insight rows.

- [ ] **Step 1: Find the result row component**

Read `src/app/search/page.tsx`. Identify the row component (likely an inline `function ResultRow` or a `.map` body). Note the per-row `kind` field — the v1 search returns both captures and insights; only captures get the action.

- [ ] **Step 2: Add the action**

Inside the row JSX:
```tsx
const [pickerOpen, setPickerOpen] = useState(false);
const [busy, setBusy] = useState(false);

const onAdd = async (collectionId: string, title: string) => {
  setBusy(true);
  const r = await authedFetch(`/api/collections/${collectionId}/items`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'capture', nodeId: result.id }),
  });
  setBusy(false);
  setPickerOpen(false);
  // surface success/error via existing search-page status mechanism (or a toast).
};

// Within the row markup, after the title/snippet:
{result.kind === 'capture' && (
  <>
    <button className="ms-btn ms-btn--ghost" onClick={() => setPickerOpen(true)} disabled={busy}>
      Add to Collection
    </button>
    <AddToCollection open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={onAdd} />
  </>
)}
{result.kind === 'insight' && (
  <span className="meta" title="Insight items aren't supported in Collections yet">
    Add to Collection (insights unsupported)
  </span>
)}
```

> If the search page is server-rendered and each row isn't already client-side, refactor each row into a small `'use client'` component so the modal can live there. Keep the refactor minimal.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/search/page.tsx
git commit -m "feat(search): Add capture results to a Collection"
```

---

### Task 25: Mind Settings — cross-publish toggle

**Files:**
- Modify: `src/app/minds/[id]/settings/page.tsx`

Add a checkbox: "Allow any member to include any capture from this Mind in their personal Collections." Only shown when the current Mind is shared (more than one member) AND the viewer is the Mind owner. Bound to `PATCH /api/workspaces/<id>/cross-publish`.

- [ ] **Step 1: Read settings page**

Read `src/app/minds/[id]/settings/page.tsx`. Determine: does it already fetch the workspace? Does it know whether the viewer is the owner? Use those signals.

- [ ] **Step 2: Add state + handler**

Wherever workspace data lives in the settings component:
```tsx
const [crossPublishBusy, setCrossPublishBusy] = useState(false);

const toggleCrossPublish = async (next: boolean) => {
  setCrossPublishBusy(true);
  const r = await authedFetch(`/api/workspaces/${workspaceId}/cross-publish`, {
    method: 'PATCH',
    body: JSON.stringify({ allow: next }),
  });
  setCrossPublishBusy(false);
  if (!r.ok) {
    setStatus((await r.json()).error ?? 'Could not save.');
    return;
  }
  // Update local workspace state so the checkbox reflects the new value.
  setWorkspace((w) => w ? { ...w, allow_member_cross_publish: next } : w);
};
```

- [ ] **Step 3: Render**

In the settings UI, gated by `isShared && isOwner`:
```tsx
{isShared && isOwner && (
  <div className="ms-field">
    <label>
      <input
        type="checkbox"
        checked={workspace?.allow_member_cross_publish ?? false}
        onChange={(e) => toggleCrossPublish(e.target.checked)}
        disabled={crossPublishBusy}
      />
      {' '}Allow any member to include any capture from this Mind in their personal Collections.
    </label>
    <div className="meta">
      When off (default), members can only add their own captures from this Mind to a Collection.
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add "src/app/minds/[id]/settings/page.tsx"
git commit -m "feat(mind-settings): cross-publish opt-in toggle (Shared Minds, owner-only)"
```

---

### Task 26: Build + verify the slice end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Full test + lint + build**

```bash
npm run test
npm run lint
npm run build
```
Expected: all green. Tests should include the 4+4=8 Collection helper tests on top of the existing 23 dates tests (31 total).

- [ ] **Step 2: Browser walk-through**

Start `npm run dev`. As the signed-in user:
1. Click "Collections" in AppNav → land on `/collections`.
2. Click "New Collection" → land on the editor with "Untitled Collection."
3. Edit title to something real, save.
4. Open a Mind, open a capture's drawer, click "Add to Collection ↗" → pick the Collection.
5. Return to the editor → the capture appears.
6. Add a text block.
7. Drag the text block above the capture; reload — order persisted.
8. Edit the capture's caption; save; reload — caption persists.
9. Set a cover image from one of the items.
10. Run a `/search` query, find a capture, add it to the Collection.
11. (If a second user is available) Invite a second user as editor; verify they can open the editor; verify they can't delete the Collection.
12. In a Shared Mind's Settings, toggle "allow members to cross-publish." Verify the corresponding add-time behavior.

Document any failures in `docs/superpowers/specs/2026-05-29-collections-archive-as-creative-form-design.md` under a new "Plan #2 follow-ups" section so they're not lost.

- [ ] **Step 3: Final commit (if any follow-up notes added)**

```bash
git add docs
git commit -m "docs(collections): plan #2 follow-up notes from browser walk-through"
```

---

## Acceptance criteria for this plan

From the spec's Verification section, plan #2 row:
- Create a Collection ✓ (Tasks 13, 5)
- Add captures from drawer ✓ (Task 22)
- Add captures from board multi-select ✓ (Task 23, conditional on existing multi-select)
- Add captures from search ✓ (Task 24)
- Reorder items ✓ (Tasks 9, 16)
- Insert text blocks ✓ (Tasks 7, 17)
- Write captions ✓ (Tasks 8, 18)
- Editor renders the Editorial view ✓ (Task 15)
- Cross-Mind items resolve only while owner is still a member ✓ (Task 7's `workspace_members` check at add-time; render-time check is deferred to plan #4 since there's no public render yet)

## Out of scope (deferred to plans #3 and #4)

- Gallery and Timeline lenses (plan #3). Columns `enabled_views` and `default_view` exist now; UI toggles ship with #3.
- Publishing, `share_code`, `/c/<code>`, the `show_summary/tags/notes` opt-ins (plan #4). Columns exist now.
- Versioned snapshots, public discovery, AI-suggested Collections, EXIF dates (parked in spec).
