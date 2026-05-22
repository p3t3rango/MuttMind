# Library-first Insights with an "Ask this Mind" chat panel

Date: 2026-05-22
Status: design — awaiting user review

## Context

The Insights page (`src/app/minds/[id]/essays/page.tsx`, branded "Insights") exposes LLM
synthesis through three frozen mode buttons — **Essay / Brief / Open questions** — each
firing one fixed prompt to `/api/essays`. This bakes three prompts into UI chrome when the
real capability underneath is open-ended. It also imposes the AI on everyone: someone who
just wants to browse and search their kept thoughts has no clean way to do that.

This redesign makes the page **library-first** (browse + search, no AI imposed) and adds a
**summonable chat panel** for those who want it. It also introduces user-controlled
**priming** — deciding which kept items actually feed the Mind's future thinking.

A larger follow-on initiative — Photos-model organization (time-as-spine, visual cards,
user-curated Collections) — is **explicitly out of scope here** and parked for its own
brainstorm. Sequence agreed with the user: *chat first, organization next.*

## Design principles

- **Two layers, never blurred.** *Evidence* (captures/nodes) — only the user adds; the AI
  never writes here. *Interpretation* (insights) — both contribute; this is the layer that
  primes synthesis. "Save to Mind" creates an interpretation, never evidence.
- **AI proposes structure; the user owns it.** Auto-tags, the Map, the Weekly Digest, and
  chat answers are proposals. The user decides what stays and what feeds.
- **Library-first, AI optional.** The library is the home. Chat is one click away, never
  in the face of someone who doesn't want it.

## The page (library-first)

Replaces the current Synthesize-button + mode-tabs layout.

1. **Search bar** (new) — filters the Mind's kept items by text / `#tag` / `kind`. Client-side
   over the loaded lists, mirroring `matchesQuery` in `dashboard/page.tsx`.
2. **Weekly Digest hero** — latest digest (essays table, `trail.kind === 'digest'`), opens in
   the existing reader. Unchanged behavior.
3. **One library, two author-lanes** of *insights*:
   - **Yours** — hand-written (`source_kind` null).
   - **Synthesized** — assistant-made kept items (`source_kind` in `chat` / `lens:*` /
     `essay` / `learned`), each labeled with its origin via the existing `sourceLabel()`.
   - Every card carries a **feeds-the-Mind toggle** (see Priming).
4. **Past syntheses** — a **collapsed disclosure** ("Past syntheses (N)") directly below the
   Yours/Synthesized lane row. Expands to the current essays-table list + `EssayMarkdown`
   reader (read-only), each with a **Save to Mind** action (→ insight). Collapsed by default
   so it doesn't compete with the live library.

### Ask panel (layout B — side panel)

- An **"Ask ✦"** button (page top-right) slides in a chat rail beside the library; closing
  returns to a pure library. Library stays visible/scrollable behind/beside it.
- **Starter chips** seed the input — *Write a brief*, *What's unresolved?*, *Full essay*,
  plus free-form. These replace the old mode tabs (the three prompts become suggestions).
- **Thread** is multi-turn and **client-side / ephemeral** in v1 (no `chats` table). Only
  *saved* answers persist (as insights). Persistence of full threads is future work.
- Each assistant answer shows **citations** (which captures it drew on) and a **＋ Save to
  Mind** action.

### Dashboard integration

- The dashboard (`dashboard/page.tsx`) gains an **"Ask this Mind →"** entry that deep-links
  to the Insights page with the Ask panel open (e.g. `?ask=1`). Dashboard stays the
  capture/evidence surface; this is just a doorway. Any "Save to Mind" anywhere (dashboard
  lenses already do this) feeds the same Synthesized lane — one library, fed from everywhere.

## Chat backend (streaming)

Build a new `POST /api/chat` by **extending the existing `/api/ask` route**
(`src/app/api/ask/route.ts`), which already: embeds the query, ranks nodes by cosine
similarity, takes top-K, injects insights + memory + Mind system prompt, and returns an
answer with citations.

Changes vs. `/api/ask`:
- Accept **conversation history** (prior turns) in the request body, not just a single query.
- **Stream** the answer. No streaming infra exists today, so add it:
  - `geminiGenerateTextStream()` in `src/lib/llm/providers/gemini.ts` — calls Gemini
    `streamGenerateContent` (SSE), reusing the existing `geminiFetch` retry helper for the
    initial connection; yields text chunks.
  - `generateTextStream()` wrapper in `src/lib/llm/index.ts` mirroring `generateText`.
  - Route returns a `ReadableStream` (SSE): `data:` events stream tokens; a final event
    carries the citations JSON. **Manual SSE on the existing Gemini wrapper** — no new heavy
    dependency (Vercel AI SDK noted as a future option, not adopted now to stay consistent
    with the current custom wrapper).
- **Gate** behind a feature flag in the existing dormancy pattern (reuse
  `MUTTMIND_ASK_ENABLED` or add `MUTTMIND_CHAT_ENABLED`); 503 "dormant" when off.
- Grounding context **respects the priming filter** (below) so muted insights don't leak in.

Client: the Ask panel reads the stream and appends tokens to the in-progress assistant
message; on completion attaches citations and reveals **Save to Mind**.

### Save to Mind

`＋ Save to Mind` → `POST /api/insights` (reuse `createInsight()`), with
`sourceKind: 'chat'`. Saved **muted by default** (see Priming defaults). Appears immediately
in the Synthesized lane, badged as assistant-authored.

Two provenance details the save must preserve (else "where did this come from" is lost):
- **The prompting question** — saved as the insight **title** (the question is what the user
  recognizes the answer by); the answer is the body. *(Confirmed.)*
- **The full citation set** — a chat answer cites multiple captures (top-K), but `insights`
  only has singular `source_node_id`. Add `source_node_ids uuid[]` to `insights` (mirrors
  `essays.source_node_ids`) and persist the answer's citations there, so the saved insight
  keeps its links back to evidence.

## Priming control (feeds-the-Mind)

Priming flows through **one chokepoint**: `formatInsightsForPrompt()` in
`src/lib/insights.ts`, used by synthesis, the digest cron (via `synthesizeEssay`), and the
chat/ask grounding. Hook the toggle there.

- **Schema:** add `feeds_priming boolean not null default true` to `public.insights`
  (new `supabase/insights_priming_patch.sql`). Add the column to the `SELECT` list and the
  `Insight` type in `src/lib/insights.ts`.
- **Filter:** at the top of `formatInsightsForPrompt()`, drop rows where
  `feeds_priming === false` before the existing learned/own split. One line; no other change
  to budgets or labels.
- **Defaults on insert** (in `createInsight`): hand-written (`source_kind` null) and
  auto-distilled `learned` → `true` (preserves today's behavior). User-saved AI artifacts
  (`chat` / `lens:*` / `essay`) → `false` (muted; the user opts them in). **This mutes new
  dashboard lens-saves too**, which feed today — intentional, for one consistent rule: any
  assistant-authored saved artifact starts muted regardless of surface.
- **Backfill:** existing rows default to `true` (they were already feeding — don't silently
  change live Minds). This creates a deliberate asymmetry — old lens/essay-saves keep
  feeding, new ones start muted — which we accept rather than retroactively muting live data.
- **Toggle API:** extend `PATCH /api/insights` to accept `feedsPriming: boolean`.
- **UI:** a **● feeds the Mind / ○ muted** control on every insight card (Yours and
  Synthesized), next to Edit/Delete.

Essays gain control **via save-to-Mind**: an essay/digest never primes on its own; saving it
creates a (muted) insight you can toggle on. The toggle lives only on insights — no essay
priming, no `essays`/`insights` table merge.

## Data model changes

- `insights`: + `feeds_priming boolean not null default true`.
- `insights`: + `source_node_ids uuid[] not null default '{}'` (multi-citation; mirrors
  `essays.source_node_ids`). The existing singular `source_node_id` stays for lens-saves.
- New `source_kind` value: `'chat'`.
- No `chats` table (ephemeral threads in v1). No essays↔insights merge.

## Decisions (confirmed with user)

1. **On-demand essays become chat answers.** ✓ The old "Synthesize → persist an essay" path
   is replaced by the chat "Full essay" chip, which streams the piece in-thread; it persists
   only if you Save to Mind. The `essays` table stays for the **digest cron** and legacy
   essays (read-only "Past syntheses").
2. **What's saved with a chat answer.** ✓ Prompting **question → insight title**, answer →
   body, full **citation set → `source_node_ids`**.
3. **Priming defaults / backfill.** ✓ Hand-written + learned feed; saved AI artifacts muted;
   existing rows preserved feeding.
4. **New lens-saves start muted** ✓ (consistency with chat saves), even though lens-saves
   feed today. Old saves keep feeding via backfill — accepted asymmetry.
5. **Manual SSE streaming** ✓ on the current Gemini wrapper rather than adopting the Vercel
   AI SDK now.

## Out of scope (parked)

- **Recommended sources** (chat chip, follow-on after v1): the assistant proposes external
  resources related to the Mind's themes/tags to help the user expand the Mind. A chosen
  recommendation is saved into the **evidence** layer via the existing `/api/capture`
  pipeline (scrape → summary → tags) — *not* the insight layer, since it's a new source, not
  an interpretation. **Requires search grounding** (Gemini Google Search tool or a web-search
  step) so recommended links are real and saveable, not hallucinated — net-new infra, hence a
  follow-on rather than a v1 chip. This is the AI-proposes / user-owns rule applied to
  evidence: the assistant only suggests; the user's save is what introduces it.
- **Photos-model organization**: time-as-spine navigation, visual-first cards, user-curated
  **Collections**, app-wide (dashboard + library) — its own brainstorm next.
  - *Near-term, can ship standalone:* **capture date shown with tags.** `nodes.created_at`
    is already stored and rendered as relative time on dashboard cards; surface the explicit
    capture date alongside the tags in the capture detail/drawer for any saved resource
    (read-only metadata, not an editable tag). First concrete piece of the time-spine.
- Persisted chat threads / multi-conversation history.
- Vercel AI SDK adoption.

## Verification

- **Priming filter:** unit-test `formatInsightsForPrompt()` — a `feeds_priming: false` row is
  excluded; `true`/legacy rows included; learned/own split unchanged.
- **Migration:** run `insights_priming_patch.sql` against a dev DB; confirm column + default,
  and that existing rows read back `feeds_priming = true`.
- **Chat stream end-to-end (browser):** open a Mind with captures, open the Ask panel, send a
  starter chip; confirm tokens stream, citations resolve to real captures, and a muted
  insight is *not* reflected in grounding while a fed one is.
- **Save → lane:** Save an answer; confirm it lands in Synthesized, badged from chat, and
  starts muted; toggle it on and confirm it then primes a follow-up answer.
- **Library-first / no-AI path:** with the chat flag off (503 dormant), confirm the library
  still browses and searches cleanly and the Ask button degrades gracefully.
- **Dashboard doorway:** "Ask this Mind →" opens the Insights page with the panel open.
