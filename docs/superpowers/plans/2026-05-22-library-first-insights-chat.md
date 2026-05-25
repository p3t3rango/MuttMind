# Library-first Insights with Ask-this-Mind Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Insights page into a library-first surface (browse + search) with a summonable streaming "Ask ✦" chat panel, one library split into Yours/Synthesized author-lanes, and a per-item "feeds the Mind" priming toggle.

**Architecture:** Backend first — a `feeds_priming` + `source_node_ids` migration on `insights`, a one-line priming filter at the single chokepoint (`formatInsightsForPrompt`), then a new NDJSON-streaming `/api/chat` route that reuses `/api/ask`'s retrieval and grounds in fed insights. Frontend second — a new `AskPanel` chat component and a library-first rewrite of the Insights page, plus a dashboard doorway. Saved chat answers become muted assistant-authored insights.

**Tech Stack:** Next.js (App Router, client components), Supabase (admin client), Gemini via custom HTTP wrapper, NDJSON streaming over `fetch`/`ReadableStream`, vitest for the core pure logic.

**Spec:** `docs/superpowers/specs/2026-05-22-library-first-insights-chat-design.md`

---

## File map

- `package.json`, `vitest.config.ts` — add vitest (devDep + `test` script + config).
- `supabase/insights_priming_patch.sql` — **create**: add `feeds_priming bool`, `source_node_ids uuid[]`.
- `src/lib/insights.ts` — **modify**: type, `SELECT`, `shape`, `createInsight`, new `setInsightPriming`, priming filter in `formatInsightsForPrompt`.
- `src/lib/insights.test.ts` — **create**: unit tests for the priming filter + default computation.
- `src/app/api/insights/route.ts` — **modify**: POST accepts `feedsPriming`/`sourceNodeIds`; PATCH supports priming-only update.
- `src/lib/llm/providers/gemini.ts` — **modify**: add `geminiGenerateTextStream`.
- `src/lib/llm/index.ts` — **modify**: add `generateTextStream`.
- `src/lib/env.ts` — **modify**: add `chatEnabled`.
- `src/app/api/chat/route.ts` — **create**: streaming, multi-turn, grounded chat.
- `src/components/ask-panel.tsx` — **create**: slide-in chat UI + streaming consumption + Save to Mind.
- `src/app/minds/[id]/essays/page.tsx` — **modify**: library-first layout, search, lanes, toggle, Past-syntheses disclosure, mount AskPanel.
- `src/app/dashboard/page.tsx` — **modify**: "Ask this Mind →" doorway (deep-link `?ask=1`).
- `theme.css` — **modify**: styles for ask panel, search, toggle, lanes.

---

## Task 1: Add vitest for core-logic tests

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest@^2`
Expected: vitest added to devDependencies, exit 0.

- [ ] **Step 2: Add the test script**

In `package.json` `"scripts"`, add `"test": "vitest run"` alongside the existing `lint`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "test": "vitest run"
}
```

- [ ] **Step 3: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Verify the runner works (no tests yet is OK)**

Run: `npm run test`
Expected: vitest runs and reports "No test files found" (exit code 1 is fine here) OR passes; the runner is wired.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest for core-logic unit tests"
```

---

## Task 2: Migration — add priming + multi-citation columns

**Files:**
- Create: `supabase/insights_priming_patch.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/insights_priming_patch.sql`:

```sql
-- Per-item priming control + multi-citation provenance for insights.
-- feeds_priming: whether this insight primes future synthesis/chat.
--   Existing rows default true (they were already feeding — don't silently
--   change live Minds). New AI-authored saves are inserted with false by the
--   app layer (see createInsight).
-- source_node_ids: the full citation set for a saved chat answer (the singular
--   source_node_id stays for lens-saves).
alter table public.insights
  add column if not exists feeds_priming boolean not null default true;

alter table public.insights
  add column if not exists source_node_ids uuid[] not null default '{}';
```

- [ ] **Step 2: Apply against the dev database**

Run the SQL in the Supabase SQL editor (or `psql` against the dev DB). Tell the user to run it if you lack DB access — this is the one step that needs their environment.
Expected: both columns exist; `select feeds_priming, source_node_ids from public.insights limit 1;` returns `true` / `{}` for any existing row.

- [ ] **Step 3: Commit**

```bash
git add supabase/insights_priming_patch.sql
git commit -m "feat(db): add feeds_priming + source_node_ids to insights"
```

---

## Task 3: insights.ts — priming filter, defaults, multi-citation

**Files:**
- Modify: `src/lib/insights.ts`
- Create: `src/lib/insights.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/insights.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultFeedsPriming, formatInsightsForPrompt, type Insight } from './insights';

function make(partial: Partial<Insight>): Insight {
  return {
    id: 'x', workspace_id: 'w', created_by: null, title: null, body: 'b',
    created_at: '', updated_at: '', source_node_id: null, source_node_ids: [],
    source_kind: null, feeds_priming: true, author: null, ...partial,
  };
}

describe('defaultFeedsPriming', () => {
  it('hand-written (null kind) feeds by default', () => {
    expect(defaultFeedsPriming(null)).toBe(true);
  });
  it('learned feeds by default', () => {
    expect(defaultFeedsPriming('learned')).toBe(true);
  });
  it('saved AI artifacts (chat/lens/essay) start muted', () => {
    expect(defaultFeedsPriming('chat')).toBe(false);
    expect(defaultFeedsPriming('lens:gist')).toBe(false);
    expect(defaultFeedsPriming('essay')).toBe(false);
  });
});

describe('formatInsightsForPrompt priming filter', () => {
  it('excludes muted insights', () => {
    const out = formatInsightsForPrompt([
      make({ body: 'KEEP-ME', feeds_priming: true }),
      make({ body: 'DROP-ME', feeds_priming: false }),
    ]);
    expect(out).toContain('KEEP-ME');
    expect(out).not.toContain('DROP-ME');
  });
  it('treats undefined/legacy feeds_priming as feeding', () => {
    const legacy = make({ body: 'LEGACY' });
    delete (legacy as Partial<Insight>).feeds_priming;
    expect(formatInsightsForPrompt([legacy])).toContain('LEGACY');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `defaultFeedsPriming` is not exported, and `feeds_priming` is not on the type.

- [ ] **Step 3: Add fields to the type and SELECT/shape**

In `src/lib/insights.ts`, extend the `Insight` type (after `source_kind`):

```ts
export type Insight = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  title: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  source_node_id: string | null;
  source_node_ids: string[];
  source_kind: string | null;
  feeds_priming: boolean;
  author?: { display_name: string | null; email: string | null } | null;
};
```

Update `SELECT`:

```ts
const SELECT =
  'id,workspace_id,created_by,title,body,created_at,updated_at,source_node_id,source_node_ids,source_kind,feeds_priming,users(display_name,email)';
```

In `shape()`, add (before `author`):

```ts
    source_node_id: (row.source_node_id ?? null) as string | null,
    source_node_ids: (row.source_node_ids ?? []) as string[],
    source_kind: (row.source_kind ?? null) as string | null,
    feeds_priming: (row.feeds_priming ?? true) as boolean,
```

- [ ] **Step 4: Add `defaultFeedsPriming` and use it in `createInsight`**

Add this exported helper near the top (after the type):

```ts
/**
 * New saves: hand-written (null) and machine-distilled 'learned' insights feed
 * the Mind by default; user-saved AI artifacts (chat / lens:* / essay) start
 * muted so the assistant never silently feeds on its own output.
 */
export function defaultFeedsPriming(sourceKind: string | null | undefined): boolean {
  return sourceKind == null || sourceKind === 'learned';
}
```

Extend `createInsight`'s input and insert:

```ts
export async function createInsight(input: {
  workspaceId: string;
  createdBy: string;
  title?: string | null;
  body: string;
  sourceNodeId?: string | null;
  sourceNodeIds?: string[] | null;
  sourceKind?: string | null;
  feedsPriming?: boolean;
}): Promise<Insight> {
  const { data, error } = await getSupabaseAdmin()
    .from('insights')
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.createdBy,
      title: input.title?.trim() || null,
      body: input.body.trim(),
      source_node_id: input.sourceNodeId ?? null,
      source_node_ids: input.sourceNodeIds ?? [],
      source_kind: input.sourceKind ?? null,
      feeds_priming: input.feedsPriming ?? defaultFeedsPriming(input.sourceKind),
    })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return shape(data as Record<string, unknown>);
}
```

- [ ] **Step 5: Add the priming filter to `formatInsightsForPrompt`**

Change the first lines of the function body (keep everything else identical):

```ts
export function formatInsightsForPrompt(
  entries: Insight[],
  userCap = 4_000,
  learnedCap = 1_500,
): string {
  const active = entries.filter((e) => e.feeds_priming !== false);
  if (!active.length) return '';
  const learned = active.filter((e) => e.source_kind === 'learned');
  const own = active.filter((e) => e.source_kind !== 'learned');
  // ...rest unchanged (blocks, packLines, return)
```

- [ ] **Step 6: Add `setInsightPriming` for the toggle**

Add after `updateInsight`:

```ts
export async function setInsightPriming(input: {
  id: string;
  workspaceId: string;
  feedsPriming: boolean;
}): Promise<Insight> {
  const { data, error } = await getSupabaseAdmin()
    .from('insights')
    .update({ feeds_priming: input.feedsPriming })
    .eq('id', input.id)
    .eq('workspace_id', input.workspaceId)
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return shape(data as Record<string, unknown>);
}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm run test`
Expected: PASS (all 5 tests green).
Run: `npm run lint`
Expected: no errors in `src/lib/insights.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/insights.ts src/lib/insights.test.ts
git commit -m "feat(insights): priming filter, feeds_priming default, multi-citation, setInsightPriming"
```

---

## Task 4: insights API — accept new fields + priming-only PATCH

**Files:**
- Modify: `src/app/api/insights/route.ts`

- [ ] **Step 1: Extend POST to accept `sourceNodeIds` and `feedsPriming`**

Replace the POST body destructure + `createInsight` call:

```ts
export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, title, body, sourceNodeId, sourceNodeIds, sourceKind, feedsPriming } =
      await req.json();
    const text = String(body ?? '').trim();
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (!text) return Response.json({ error: 'Insight body required.' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);
    const insight = await createInsight({
      workspaceId,
      createdBy: userId,
      title: typeof title === 'string' ? title : null,
      body: text,
      sourceNodeId: typeof sourceNodeId === 'string' ? sourceNodeId : null,
      sourceNodeIds: Array.isArray(sourceNodeIds)
        ? sourceNodeIds.filter((x: unknown): x is string => typeof x === 'string')
        : null,
      sourceKind: typeof sourceKind === 'string' ? sourceKind : null,
      feedsPriming: typeof feedsPriming === 'boolean' ? feedsPriming : undefined,
    });
    return Response.json({ insight });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
```

- [ ] **Step 2: Support priming-only PATCH**

Add `setInsightPriming` to the import from `@/lib/insights`, then replace the PATCH body so a `{ feedsPriming }` payload toggles priming without requiring `body`:

```ts
export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, id, title, body, feedsPriming } = await req.json();
    if (!workspaceId || !id) {
      return Response.json({ error: 'workspaceId and id required' }, { status: 400 });
    }
    const role = await assertWorkspaceMember(workspaceId, userId);
    const gate = await assertCanMutate(id, workspaceId, userId, role);
    if ('missing' in gate) return Response.json({ error: 'Insight not found.' }, { status: 404 });
    if ('forbidden' in gate) {
      return Response.json({ error: 'Only the author or a Mind admin can edit this.' }, { status: 403 });
    }

    // Priming-only toggle: no body change required. Contract — priming-only
    // callers omit `body` entirely (covers both undefined and null).
    if (typeof feedsPriming === 'boolean' && body == null) {
      const insight = await setInsightPriming({ id, workspaceId, feedsPriming });
      return Response.json({ insight });
    }

    const text = String(body ?? '').trim();
    if (!text) return Response.json({ error: 'Insight body required.' }, { status: 400 });
    const insight = await updateInsight({
      id,
      workspaceId,
      title: typeof title === 'string' ? title : null,
      body: text,
    });
    return Response.json({ insight });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run lint`
Expected: no errors in the route.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/insights/route.ts
git commit -m "feat(api): insights POST accepts sourceNodeIds/feedsPriming; PATCH toggles priming"
```

---

## Task 5: Gemini streaming + wrapper

**Files:**
- Modify: `src/lib/llm/providers/gemini.ts`
- Modify: `src/lib/llm/index.ts`

- [ ] **Step 1: Add `geminiGenerateTextStream`**

In `src/lib/llm/providers/gemini.ts`, add after `geminiGenerateText`:

```ts
/**
 * Streaming variant of geminiGenerateText. Calls streamGenerateContent with
 * SSE and yields text deltas as they arrive. Reuses geminiFetch for the
 * initial connection (retry/backoff), then reads the SSE body manually.
 */
export async function* geminiGenerateTextStream(
  input: GeminiGenerateTextInput,
): AsyncGenerator<string> {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY is required');
  const model = input.model ?? env.geminiModel;
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: input.prompt }] }],
  };
  if (input.systemPrompt) body.system_instruction = { parts: [{ text: input.systemPrompt }] };

  const response = await geminiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${env.geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok || !response.body) {
    const errorText = response.body ? await response.text() : '';
    throw new Error(`Gemini stream failed: ${response.status} ${errorText.slice(0, 180)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Assumption: Gemini SSE emits one `data: {json}` per line (no multi-line
  // data blocks), so newline-splitting is sufficient. If Gemini ever changes
  // framing to multi-line SSE events, switch to splitting on '\n\n'.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const json = trimmed.slice(5).trim();
      if (!json || json === '[DONE]') continue;
      try {
        const parsed = JSON.parse(json);
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === 'string' && text) yield text;
      } catch {
        // partial JSON across chunks — ignore; the next read completes it
      }
    }
  }
}
```

- [ ] **Step 2: Add `generateTextStream` to the wrapper**

In `src/lib/llm/index.ts`, add `geminiGenerateTextStream` to the import, then add:

```ts
export async function* generateTextStream(
  input: GenerateTextInput,
): AsyncGenerator<string> {
  const provider = resolveProvider(input.provider);
  switch (provider) {
    case 'gemini':
      yield* geminiGenerateTextStream({
        prompt: input.prompt,
        systemPrompt: input.systemPrompt,
        model: input.model,
      });
      return;
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/llm/providers/gemini.ts src/lib/llm/index.ts
git commit -m "feat(llm): streaming Gemini text generation"
```

---

## Task 6: Add the chat feature flag

**Files:**
- Modify: `src/lib/env.ts`

- [ ] **Step 1: Add `chatEnabled`**

In `src/lib/env.ts`, add alongside the other flags:

```ts
  chatEnabled: process.env.MUTTMIND_CHAT_ENABLED === '1',
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/env.ts
git commit -m "feat(env): MUTTMIND_CHAT_ENABLED flag"
```

---

## Task 7: `/api/chat` — streaming, multi-turn, grounded

**Files:**
- Create: `src/app/api/chat/route.ts`

NDJSON protocol (one JSON object per line): `{"type":"token","text":"..."}`,
then `{"type":"citations","citations":[...]}`, then `{"type":"done"}`; on error
`{"type":"error","error":"..."}`.

- [ ] **Step 1: Write the route**

Create `src/app/api/chat/route.ts`:

```ts
import { requireUserId } from '@/lib/auth';
import { env } from '@/lib/env';
import { embeddingProcess, generateTextStream } from '@/lib/llm';
import { formatInsightsForPrompt, listInsights } from '@/lib/insights';
import { formatMemoryForPrompt, listMindMemory } from '@/lib/mind-memory';
import { buildRuntimeSystemPrompt } from '@/lib/minds-prompts';
import { getSupabaseAdmin } from '@/lib/supabase';
import { cosineSimilarity, parseEmbedding } from '@/lib/vector';
import { assertWorkspaceMember } from '@/lib/workspace';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type WorkspaceRow = { id: string; name: string; system_prompt: string | null; provider: string | null; model: string | null };
type NodeRow = { id: string; title: string | null; original_url: string | null; ai_summary: string | null; source_description: string | null; user_notes: string | null; embedding: unknown };

function line(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
}

/**
 * POST /api/chat
 * Body: { workspaceId, messages: ChatMessage[] }
 * Streams NDJSON tokens grounded in the Mind's captures + fed insights, then a
 * citations line, then done. Gated behind MUTTMIND_CHAT_ENABLED.
 */
export async function POST(req: Request) {
  if (!env.chatEnabled) {
    return Response.json(
      { error: 'Chat is not yet enabled on this server.', hint: 'Set MUTTMIND_CHAT_ENABLED=1 to activate.' },
      { status: 503 },
    );
  }

  let workspaceId: string;
  let messages: ChatMessage[];
  try {
    const userId = await requireUserId(req);
    const parsed = await req.json();
    workspaceId = parsed?.workspaceId;
    messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser?.content?.trim()) return Response.json({ error: 'A user message is required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unauthorized' }, { status: 401 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user')!;
        const query = lastUser.content.trim();

        const { data: workspaceRow, error: wErr } = await getSupabaseAdmin()
          .from('workspaces').select('id,name,system_prompt,provider,model').eq('id', workspaceId).single();
        if (wErr) throw new Error(wErr.message);
        const workspace = workspaceRow as WorkspaceRow;

        const queryEmbedding = await embeddingProcess({ text: query });
        const { data: nodesData, error: nErr } = await getSupabaseAdmin()
          .from('nodes')
          .select('id,title,original_url,ai_summary,source_description,user_notes,embedding')
          .eq('workspace_id', workspaceId);
        if (nErr) throw new Error(nErr.message);

        const ranked = (nodesData ?? [])
          .map((row) => {
            const node = row as NodeRow;
            const embedding = parseEmbedding(node.embedding);
            return { ...node, similarity: embedding.length ? cosineSimilarity(queryEmbedding, embedding) : 0 };
          })
          .filter((n) => n.similarity > 0)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 8);

        const memoryFragment = formatMemoryForPrompt(await listMindMemory({ workspaceId, limit: 8 }));
        const insightsFragment = formatInsightsForPrompt(await listInsights({ workspaceId, limit: 40 }));

        const sourcesFragment = ranked
          .map((n, i) => {
            const lines = [`[${i + 1}] ${n.title ?? 'Untitled'}`];
            if (n.original_url) lines.push(`URL: ${n.original_url}`);
            if (n.ai_summary) lines.push(`Summary: ${n.ai_summary}`);
            else if (n.source_description) lines.push(`Description: ${n.source_description}`);
            if (n.user_notes) lines.push(`User notes: ${n.user_notes}`);
            return lines.join('\n');
          })
          .join('\n\n---\n\n');

        const history = messages
          .slice(-8)
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.trim()}`)
          .join('\n\n');

        const prompt = [
          insightsFragment ? `${insightsFragment}\n\n---\n\n` : '',
          memoryFragment ? `${memoryFragment}\n\n---\n\n` : '',
          ranked.length
            ? `Sources from the Mind "${workspace.name}", ranked by relevance:\n\n${sourcesFragment}\n\n---\n\n`
            : `The Mind "${workspace.name}" has no captures matching this yet — answer from the conversation and say what's missing.\n\n---\n\n`,
          `Conversation so far:\n${history}\n\n---\n\n`,
          `Answer the latest user message grounded in the sources above. Use inline citations like [1], [2] referring to the numbered sources where you draw on them. Be tight and concrete; if the sources don't cover it, say so.`,
        ].join('');

        const systemPrompt = buildRuntimeSystemPrompt({ mindSystemPrompt: workspace.system_prompt });
        const provider = workspace.provider === 'gemini' ? 'gemini' : undefined;
        const model = workspace.model && workspace.model.trim() ? workspace.model : undefined;

        for await (const delta of generateTextStream({ prompt, systemPrompt, provider, model })) {
          controller.enqueue(line({ type: 'token', text: delta }));
        }
        controller.enqueue(
          line({
            type: 'citations',
            citations: ranked.map((n, i) => ({ index: i + 1, nodeId: n.id, title: n.title, url: n.original_url })),
          }),
        );
        controller.enqueue(line({ type: 'done' }));
      } catch (e) {
        controller.enqueue(line({ type: 'error', error: e instanceof Error ? e.message : 'unknown' }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke (browser/curl) — deferred to Task 11**

The end-to-end stream check runs in Task 11 once the panel exists. For now confirm the route compiles in `npm run build` (Task 11 covers the full build).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat(api): streaming, multi-turn, grounded /api/chat"
```

---

## Task 8: AskPanel component

**Files:**
- Create: `src/components/ask-panel.tsx`

The panel owns conversation state, streams from `/api/chat`, renders the thread,
and saves an answer via `POST /api/insights` (sourceKind `chat`, question→title,
citations→sourceNodeIds; muted by default via `defaultFeedsPriming`).

- [ ] **Step 1: Write the component**

Create `src/components/ask-panel.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { authedFetch, getAccessToken } from '@/lib/client-auth';

type Citation = { index: number; nodeId: string; title: string | null; url: string | null };
type Turn = {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  pending?: boolean;
  savedInsightId?: string;
};

const STARTERS = [
  'Write me a brief on this Mind.',
  "What's unresolved across what I've saved?",
  'Write a full essay synthesizing this Mind.',
];

export function AskPanel({
  open,
  onClose,
  workspaceId,
  mindName,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  mindName: string;
  onSaved: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  };

  const send = async (text: string) => {
    const query = text.trim();
    if (!query || busy || !workspaceId) return;
    setError('');
    setInput('');
    const history: Turn[] = [...turns, { role: 'user', content: query }];
    setTurns([...history, { role: 'assistant', content: '', pending: true }]);
    setBusy(true);
    scrollToEnd();

    try {
      const token = await getAccessToken();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          workspaceId,
          messages: history.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      if (res.status === 503) {
        setError('Chat is dormant. Set MUTTMIND_CHAT_ENABLED=1 and restart the dev server.');
        setTurns((cur) => cur.slice(0, -1));
        return;
      }
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Could not reach the Mind.');
        setTurns((cur) => cur.slice(0, -1));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const apply = (evt: { type: string; text?: string; citations?: Citation[]; error?: string }) => {
        setTurns((cur) => {
          const next = [...cur];
          const last = next[next.length - 1];
          if (!last || last.role !== 'assistant') return cur;
          if (evt.type === 'token') next[next.length - 1] = { ...last, content: last.content + (evt.text ?? ''), pending: false };
          else if (evt.type === 'citations') next[next.length - 1] = { ...last, citations: evt.citations, pending: false };
          else if (evt.type === 'error') next[next.length - 1] = { ...last, content: last.content || `(${evt.error})`, pending: false };
          return next;
        });
        if (evt.type === 'token') scrollToEnd();
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const l of lines) {
          const t = l.trim();
          if (!t) continue;
          try { apply(JSON.parse(t)); } catch { /* partial line; next read completes it */ }
        }
      }
    } catch {
      setError('The connection dropped mid-answer. Try again.');
      setTurns((cur) => cur.slice(0, -1));
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  };

  const saveAnswer = async (idx: number) => {
    const answer = turns[idx];
    const question = turns[idx - 1];
    if (!answer || answer.role !== 'assistant') return;
    const r = await authedFetch('/api/insights', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        title: question?.content?.slice(0, 140) ?? 'From a chat',
        body: answer.content,
        sourceKind: 'chat',
        sourceNodeIds: (answer.citations ?? []).map((c) => c.nodeId),
      }),
    });
    const d = await r.json();
    if (r.ok && d.insight) {
      setTurns((cur) => cur.map((t, i) => (i === idx ? { ...t, savedInsightId: d.insight.id } : t)));
      onSaved();
    }
  };

  if (!open) return null;

  return (
    <div className="ask-panel" role="dialog" aria-modal="false" aria-label={`Ask ${mindName}`}>
      <header className="ask-panel__head">
        <span className="ask-panel__title">Ask {mindName || 'this Mind'}</span>
        <button type="button" className="ask-panel__close" onClick={onClose} aria-label="Close chat">✕</button>
      </header>

      <div className="ask-panel__thread" ref={scrollRef}>
        {turns.length === 0 ? (
          <div className="ask-panel__starters">
            <p className="ask-panel__hint">Ask anything grounded in this Mind, or start with:</p>
            {STARTERS.map((s) => (
              <button key={s} type="button" className="ask-starter" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={`ask-turn ask-turn--${t.role}`}>
              <div className="ask-turn__body">
                {t.pending && !t.content ? <span className="ask-turn__thinking">Thinking…</span> : t.content}
              </div>
              {t.role === 'assistant' && !t.pending && t.content ? (
                <div className="ask-turn__foot">
                  {t.citations?.length ? (
                    <span className="ask-turn__cites">
                      {t.citations.map((c) => (
                        c.url ? (
                          <a key={c.index} href={c.url} target="_blank" rel="noreferrer" className="ask-cite">[{c.index}] {c.title ?? 'source'}</a>
                        ) : (
                          <span key={c.index} className="ask-cite">[{c.index}] {c.title ?? 'source'}</span>
                        )
                      ))}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="insight-link"
                    onClick={() => saveAnswer(i)}
                    disabled={Boolean(t.savedInsightId)}
                  >
                    {t.savedInsightId ? 'Saved to Mind ✓ (muted)' : '＋ Save to Mind'}
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
        {error ? <p className="ask-panel__error">{error}</p> : null}
      </div>

      <form
        className="ask-panel__compose"
        onSubmit={(e) => { e.preventDefault(); send(input); }}
      >
        <textarea
          className="ask-panel__input"
          value={input}
          placeholder="Ask this Mind…"
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(input); }
          }}
        />
        <button type="submit" className="ms-btn" disabled={busy || !input.trim()}>
          {busy ? 'Asking…' : 'Ask'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors in `ask-panel.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ask-panel.tsx
git commit -m "feat(ui): AskPanel streaming chat with save-to-Mind"
```

---

## Task 9: Library-first Insights page

**Files:**
- Modify: `src/app/minds/[id]/essays/page.tsx`

Reframe the page: add search, restructure into Yours/Synthesized lanes with a
priming toggle, keep the Digest hero, move legacy essays into a collapsed "Past
syntheses" disclosure, mount the AskPanel behind an "Ask ✦" button, and remove
the old Synthesize button + mode tabs + phase animation.

- [ ] **Step 1: Imports + new state**

At the top of `page.tsx`, add to the imports:

```tsx
import { AskPanel } from '@/components/ask-panel';
```

Remove the `Mode`, `MODES`, `PHASES` constants and the `mode`/`phase`/`isGenerating`/`dormant`/`status`/`phaseTimer` state and the `generate`/`stopPhases` functions (the old synthesis-button flow). Add:

```tsx
const [askOpen, setAskOpen] = useState(false);
const [query, setQuery] = useState('');
const [pastOpen, setPastOpen] = useState(false);
```

Read the deep-link to auto-open the panel (after `mindId` is known):

```tsx
useEffect(() => {
  const sp = new URLSearchParams(window.location.search);
  if (sp.get('ask') === '1') setAskOpen(true);
}, []);
```

- [ ] **Step 2: Add the priming toggle handler**

Add near the other insight handlers:

```tsx
const togglePriming = async (id: string, next: boolean) => {
  setInsights((cur) => cur.map((x) => (x.id === id ? { ...x, feeds_priming: next } : x)));
  const r = await authedFetch('/api/insights', {
    method: 'PATCH',
    body: JSON.stringify({ workspaceId: mindId, id, feedsPriming: next }),
  });
  if (!r.ok) {
    setInsights((cur) => cur.map((x) => (x.id === id ? { ...x, feeds_priming: !next } : x)));
  }
};
```

Extend the `Insight` type in this file to include the new fields:

```tsx
type Insight = {
  id: string;
  title: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  source_kind?: string | null;
  source_node_id?: string | null;
  feeds_priming?: boolean;
  author?: { display_name: string | null; email: string | null } | null;
};
```

- [ ] **Step 3: Compute lanes + search filter**

Replace the `ownInsights`/`learnedInsights` derivation with author-lane + search logic:

```tsx
const q = query.trim().toLowerCase();
const matches = (i: Insight) =>
  !q || `${i.title ?? ''} ${i.body}`.toLowerCase().includes(q);
const yours = insights.filter((i) => (i.source_kind ?? null) === null && matches(i));
const synthesized = insights.filter((i) => (i.source_kind ?? null) !== null && matches(i));
```

- [ ] **Step 4: Reusable insight-card renderer with toggle**

Add a small renderer above the `return` (keeps Yours/Synthesized DRY). It reuses the existing edit/delete state already in the component:

```tsx
const renderInsightCard = (it: Insight) => (
  <li key={it.id} className="insight-item">
    {it.title ? <p className="insight-item__title">{it.title}</p> : null}
    <p className="insight-item__body">{it.body}</p>
    <div className="insight-item__meta">
      <span>
        {it.author?.display_name || it.author?.email || 'Unknown'}
        {' · '}{relativeTime(it.updated_at)}
        {it.source_kind ? ` · ${sourceLabel(it.source_kind)}` : ''}
      </span>
      <span className="insight-item__actions">
        <button
          type="button"
          className={`prime-toggle ${it.feeds_priming !== false ? 'prime-toggle--on' : ''}`}
          onClick={() => togglePriming(it.id, it.feeds_priming === false)}
          title={it.feeds_priming !== false ? 'Feeding the Mind — click to mute' : 'Muted — click to feed the Mind'}
        >
          {it.feeds_priming !== false ? '● feeds the Mind' : '○ muted'}
        </button>
        {confirmDeleteId === it.id ? (
          <>
            <button type="button" className="insight-link insight-link--danger" onClick={() => removeInsight(it.id)}>Confirm delete</button>
            <button type="button" className="insight-link" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
          </>
        ) : (
          <button type="button" className="insight-link" onClick={() => setConfirmDeleteId(it.id)}>Delete</button>
        )}
      </span>
    </div>
  </li>
);
```

- [ ] **Step 5: Replace the page body (header, search, hero, lanes, past syntheses, panel)**

Replace everything inside `<section className="ms-page essays-page">` so the layout is library-first. Keep the existing `loadEssays`/`loadInsights`/`digestPreview`/`latestDigest`/`olderDigests` logic and the `EssayMarkdown` reader; the new body:

```tsx
<header className="ms-top">
  <div className="ms-crumb">
    <Link href="/minds" className="ms-crumb__link">minds</Link>
    <span className="ms-crumb__sep">/</span>
    <span>{mindName || 'Mind'}</span>
    <span className="ms-crumb__sep">/</span>
    <span className="ms-crumb__current">insights</span>
  </div>
  <button type="button" className="ms-btn" onClick={() => setAskOpen(true)}>Ask ✦</button>
</header>

<nav className="dash-pivots" aria-label="View">
  <Link href="/minds" className="dash-pivot">Minds</Link>
  <Link href="/dashboard" className="dash-pivot">Dashboard</Link>
  <Link href="/vault" className="dash-pivot">Map</Link>
  <span className="dash-pivot dash-pivot--active">Insights</span>
</nav>

<input
  className="library-search"
  type="search"
  value={query}
  placeholder="Search this Mind's library…"
  onChange={(e) => setQuery(e.target.value)}
/>

{/* RELOCATE VERBATIM (not a new component): move the existing digest-hero block
    here unchanged — currently the `{latestDigest ? ( <section className="digest-hero …">
    … </section> ) : null}` block at page.tsx lines ~392–453. It already uses
    openId/setOpenId/nonDigests/olderDigests/olderDigestsOpen/relativeTime/digestPreview,
    all of which still exist. Do not rewrite its internals. */}

<div className="insights-lane-row">
  <p className="insights-lane">Yours <span className="insights-lane__sub">· you wrote these</span></p>
  <button type="button" className="insight-link" onClick={() => setComposeOpen((v) => !v)}>
    {composeOpen ? 'Cancel' : '+ Add an insight'}
  </button>
</div>
{/* keep the existing compose block */}
{yours.length ? <ul className="insight-list" role="list">{yours.map(renderInsightCard)}</ul>
  : <p className="ms-section__hint">No insights yet — jot what you're noticing. The assistant reads these when it answers.</p>}

<div className="insights-lane-row">
  <p className="insights-lane">Synthesized <span className="insights-lane__sub">· the assistant made these</span></p>
</div>
{synthesized.length ? <ul className="insight-list" role="list">{synthesized.map(renderInsightCard)}</ul>
  : <p className="ms-section__hint">Saved chat answers and lens saves land here, muted until you switch them on.</p>}

{nonDigests.length ? (
  <div className="past-syntheses">
    <button type="button" className="insight-link" onClick={() => setPastOpen((v) => !v)} aria-expanded={pastOpen}>
      {pastOpen ? 'Hide' : 'Past syntheses'} ({nonDigests.length})
    </button>
    {pastOpen ? (
      /* RELOCATE VERBATIM (not a new component): move the existing two-pane essays
         block here unchanged — currently `<div className="essays-layout"> … </div>`
         at page.tsx lines ~455–561, rendering essays-list (nonDigests) + essays-reader
         (openEssay, openSources, deleteEssay, saveEssayToInsights, savedEssayId,
         confirmDeleteEssayId, essayKindLabel, EssayMarkdown). */
      null
    ) : null}
  </div>
) : null}
```

> **Implementer note (read before editing):** the digest-hero block, the
> `insight-compose` block, and the `essays-layout` two-pane block already exist in
> the current file (digest-hero ~392–453, compose ~575–602, essays-layout ~455–561).
> These are **inline JSX, not components** — physically cut each block from its
> current spot and paste it (unchanged) into the position marked above. Do not
> create `DigestHero`/`EssaysReader` components and do not rewrite the internals.
> The only outright deletions are: the Synthesize button, the `syn-modes` mode-tab
> block, the `syn-loading` phase block, and the dormant/`status` blocks tied to the
> removed `generate` flow.

- [ ] **Step 6: Mount the panel before `</main>`**

```tsx
<AskPanel
  open={askOpen}
  onClose={() => setAskOpen(false)}
  workspaceId={mindId}
  mindName={mindName}
  onSaved={loadInsights}
/>
```

- [ ] **Step 7: Typecheck + lint**

Run: `npm run lint`
Expected: no unused-variable errors.

Then prove the old flow is fully gone (not just the state declarations — these names also appear in effects, callbacks, and JSX):

Run: `git grep -nE 'isGenerating|phaseTimer|stopPhases|syn-modes|syn-loading|\bMODES\b|\bPHASES\b' 'src/app/minds/[id]/essays/page.tsx'`
Expected: **no output** (zero matches). Any hit is a leftover reference to fix.

- [ ] **Step 8: Commit**

```bash
git add src/app/minds/[id]/essays/page.tsx
git commit -m "feat(ui): library-first Insights — search, lanes, priming toggle, Ask panel"
```

---

## Task 10: Dashboard "Ask this Mind →" doorway

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Add the doorway action**

In the `dash-actions` block (next to "Synthesize"), add an entry that deep-links
to the Insights page with the panel open:

```tsx
{workspaceId ? (
  <Link href={`/minds/${workspaceId}/essays?ask=1`} className="dash-action">
    Ask this Mind <span aria-hidden="true">→</span>
  </Link>
) : null}
```

(`Link` is already imported in this file.)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(ui): dashboard 'Ask this Mind' doorway into the chat panel"
```

---

## Task 11: Styles + full build + end-to-end verification

**Files:**
- Modify: `theme.css`

- [ ] **Step 1: Add styles**

Append to `theme.css` (match existing tokens/spacing; adjust values to taste during review):

```css
/* Library search */
.library-search {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--line, #ddd);
  border-radius: 18px;
  background: #fff;
  font: inherit;
  margin: 8px 0 18px;
}

/* Priming toggle */
.prime-toggle {
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 2px 9px;
  font-size: 11px;
  cursor: pointer;
  background: #f0eee9;
  color: #998;
}
.prime-toggle--on { background: #e7f1e7; color: #3a7a3a; }

.insights-lane__sub { font-weight: 400; color: #aaa; }
.past-syntheses { margin-top: 18px; border-top: 1px solid #e6e4dd; padding-top: 12px; }

/* Ask panel — slide-in rail */
.ask-panel {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: min(440px, 92vw);
  background: #fff; border-left: 1px solid var(--line, #ddd);
  box-shadow: -6px 0 24px rgba(0,0,0,.08);
  display: flex; flex-direction: column; z-index: 50;
}
.ask-panel__head { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid #eee; }
.ask-panel__title { font-weight: 600; }
.ask-panel__close { border: none; background: none; cursor: pointer; font-size: 15px; }
.ask-panel__thread { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.ask-panel__starters { display: flex; flex-direction: column; gap: 8px; }
.ask-panel__hint { color: #888; font-size: 13px; }
.ask-starter { text-align: left; border: 1px solid #e3e1d9; border-radius: 10px; padding: 8px 12px; background: #faf9f6; cursor: pointer; font: inherit; }
.ask-turn { display: flex; flex-direction: column; gap: 6px; }
.ask-turn--user .ask-turn__body { align-self: flex-end; background: #e8e6df; border-radius: 12px; padding: 8px 12px; max-width: 85%; }
.ask-turn--assistant .ask-turn__body { background: #f5f4f0; border-radius: 12px; padding: 10px 12px; white-space: pre-wrap; }
.ask-turn__thinking { color: #999; font-style: italic; }
.ask-turn__foot { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 12px; }
.ask-turn__cites { display: flex; gap: 8px; flex-wrap: wrap; color: #888; }
.ask-cite { color: #888; text-decoration: none; }
.ask-cite:hover { text-decoration: underline; }
.ask-panel__error { color: #b4452f; font-size: 13px; }
.ask-panel__compose { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #eee; }
.ask-panel__input { flex: 1; resize: none; border: 1px solid var(--line, #ddd); border-radius: 12px; padding: 8px 10px; font: inherit; }
```

- [ ] **Step 2: Full production build**

Run: `npm run build`
Expected: build succeeds with no type errors across the modified routes/components.

- [ ] **Step 3: Enable the flag and run the app**

Add `MUTTMIND_CHAT_ENABLED=1` to `.env.local`, run `npm run dev`. (Tell the user to do this if you can't edit their `.env.local`.)

- [ ] **Step 4: End-to-end browser verification (per spec)**

Open a Mind that has captures (`/minds/<id>/essays`) and confirm:
1. **Library-first / no-AI path:** the page shows search + Yours/Synthesized lanes + Digest hero with no chat thrust forward; typing in search filters cards.
2. **Stream:** click "Ask ✦", send a starter; tokens stream in, then citations resolve to real captures.
3. **Save → lane:** Save an answer; it appears in **Synthesized**, badged "from a chat", showing **○ muted**.
4. **Priming round-trip:** toggle that saved insight to **● feeds the Mind**, ask a related follow-up, and confirm the answer reflects it; toggle a different insight to muted and confirm it stops showing in grounding.
5. **Past syntheses:** the disclosure expands to the legacy essay reader; "Save to Mind" on an essay creates a muted Synthesized insight.
6. **Dashboard doorway:** from `/dashboard`, "Ask this Mind →" opens `/minds/<id>/essays?ask=1` with the panel open.
7. **Dormant path:** with the flag off, the panel shows the dormant message and the library still works.
8. **Cross-surface muted save:** on the dashboard, run a lens on a capture and "Save to Insights"; confirm the new save shows in the **Synthesized** lane as **○ muted** (the intended behavior change — old lens-saves stay feeding, new ones start muted).

- [ ] **Step 5: Commit**

```bash
git add theme.css
git commit -m "feat(ui): styles for ask panel, library search, priming toggle"
```

---

## Self-review notes

- **Spec coverage:** library-first + search (T9), Yours/Synthesized lanes (T9), priming toggle + chokepoint filter (T3/T9), `feeds_priming` defaults + backfill (T2/T3), multi-citation `source_node_ids` (T2/T3/T8), streaming multi-turn grounded chat (T5/T7), save-to-Mind question→title + citations + muted (T8), Past-syntheses disclosure (T9), dashboard doorway (T10), dormant gating (T6/T7/T11). ✓
- **Parked (not in this plan):** Recommended-sources chip, Photos-model organization, capture-date display, persisted chat threads.
- **Type consistency:** `feeds_priming` is optional on the page-local `Insight` type and treated as "feeding unless explicitly false" everywhere (`feeds_priming !== false`), matching the DB default and the filter in `formatInsightsForPrompt`.
```
