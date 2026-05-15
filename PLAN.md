# MuttMind — Synthesis Engine Plan

> A staged plan to evolve MuttMind from a capture/curation tool into a *Shared Mind* — a low-friction, AI-augmented place where individuals or groups capture across the web, watch the Mind organize itself, and receive synthesis (essays, digests, suggested external sources) that helps them see patterns, reuse knowledge, and extend their thinking.

## The unit is a Mind (Are.na-aligned)

A user has many **Minds**. A Mind is a focused container — like an Are.na channel — for one research project, topic, or interest. A Shared Mind is the same thing with multiple members. **There is no "Space" concept above or below Minds.** Each Mind has its own:

- system prompt (defines how the assistant behaves inside it)
- voice (system prompt / one user's notes / multiple users' notes blended)
- members (solo by default; share to make it a Shared Mind)
- captures, tags, notes
- LLM provider/model (with workspace and user defaults)
- synthesis cadence and external scouting settings (when those features land)

Captures may eventually live in many Minds at once via Are.na-style "Connect" (Feature 1.5: Manual collection).

## Vision

The product loop:

```
capture (web / Telegram)
   → enrichment (summary, tags, embedding)
   → relevance gate (does this fit a Space?)
   → resonance (cosine clustering, surfaces "this connects to that")
   → synthesis (essays / digests delivered to Telegram + web)
   → outward scouting (Wikipedia / feeds / search) — surfaces *candidates* for review
   → user approves a candidate → it's a new capture → loop continues
```

A "Mind" is the workspace. A "Space" is a research project inside a Mind with its own system prompt, voice, sources, and synthesis cadence. One Mind can host many Spaces.

## Origin / why this exists

Every collaborative project starts with people sharing links into a chat. The links go to die — no one rereads them, no patterns surface, nothing gets synthesized, no one notices the obvious thing missing. MuttMind makes the dump useful: it organizes, it connects, it surfaces, it writes.

## Locked decisions

| Decision | Choice | Notes |
|---|---|---|
| Spaces vs. Mind for system prompt | **Per-Space**, with Mind-level defaults | Spaces inherit, can override |
| Onboarding | Per-Space sequence-of-questions, **skippable** | Skip → bootstrap from title + first captures |
| Capture-time prompt | **None**. Add-note affordance instead | Don't pester at capture |
| Provenance | Explicit `source` field, never inferred | `user_save_telegram` / `user_save_web` / `feed:hn` / `candidate_approved` / `essay_derived` |
| Cost discipline | Lean inward; outward is opt-in, capped, free-source-first | Wikipedia / arXiv / HN before paid |
| Delivery | Candidates queue + weekly digest | Per-link inline-keyboard approve/deny/ask-why on Telegram |
| Feeds | User-opted; per-feed kill switch (Telegram + web) | Suggested feeds in onboarding deferred |
| Newsletter | On the roadmap as separate output type | Mechanics later |
| Local LLM | Future-note only | Not v1 |
| API keys | **Per-workspace** primary; per-user keys opt-in via workspace setting | Admins control; per-member permissions can delegate |
| Permissions | Role (owner/admin/member) + per-member delegated permissions | Admins grant specific privileges (e.g. `manage_api_keys`) without promoting to admin |
| LLM providers (eventual) | Gemini (hosted default), Anthropic, OpenAI, OpenRouter | OpenRouter covers the long tail |
| Default voice for new Space | Generated system prompt from onboarding | Notes-based voice opt-in once notes exist |
| Workflow | **One feature, one branch, one approval gate at a time** | Test before moving on |

## Design north star: Are.na

When in doubt about UI, defer to Are.na's aesthetic. The product is minimal, content-focused, and distraction-free. Specifically:

- Content is the visual hero. UI affordances stay quiet.
- No engagement-bait surfaces (notification badges, hot streaks, trending things). This is not a social media app.
- Block-style thinking: a saved item ("node") can live in multiple Minds without duplication (see Feature 1.5: Manual collection).
- Connections / trails are a first-class viewing surface. The graph view, the "this connects to that" essays, future "see who else has this in their Mind" trails.
- Algorithm-free; surface things by genuine resonance only.

Borrowable patterns: single-column reading-mode pages for essays, channel-style listing for Spaces (just a title + a stack of blocks, no metadata clutter), quiet monochrome palette with content providing the color.

## Cost discipline (cross-cutting principle)

- Default to the cheapest path: Wikipedia and free APIs before paid LLM scouting.
- Embeddings happen once per node, never re-embed unless the source text changes.
- Feed items go through a *relevance gate* (cosine vs. Mind/Space centroid) before any LLM touches them.
- Per-Mind weekly synthesis cap, configurable.
- Per-user BYO LLM is the long-term sustainability story.

## Provenance model

Every node gets a `source` field tracking how it entered the corpus:

| Source value | Meaning |
|---|---|
| `user_save_web` | Saved via web app |
| `user_save_telegram` | Saved via Telegram bot |
| `candidate_approved` | Was a candidate suggestion (essay or feed-derived), approved into corpus |
| `feed:<type>` | Auto-ingested from a configured feed |
| `essay_derived` | A synthesis essay saved as a node (recursion) |

A node having no user note is **not** a signal of provenance — provenance is the explicit field.

## Feature sequence

Each feature is its own branch off `main`. Each ends with: a working demo, a short test plan executed by the user, and explicit approval before merging and starting the next feature.

### Feature 1 — Minds with system prompt + onboarding (foundation)

**Branch:** `feature/minds-foundation` (originally `feature/spaces-onboarding` — collapsed)

**Scope:**
- Schema (`workspaces` is the Mind):
  - `system_prompt text`, `voice_source` (`system_prompt` | `user_notes` | `mind_notes`), `voice_user_ids uuid[]`, `provider text`, `model text`.
  - **Permissions system:**
    - Table `workspace_member_permissions(workspace_id, user_id, permission_key, granted_by, granted_at)`.
    - Initial enum of permission keys: `manage_mind`, `manage_voice`, `manage_members`. Extended in later features (`manage_api_keys` in Feature 9, `manage_feeds` in Feature 7).
    - Helper: `userCan(userId, workspaceId, permissionKey)` — owner/admin always true; members true with explicit grant.
- LLM adapter (`src/lib/llm/`): provider-agnostic interface + Gemini implementation + `generateText()` helper for arbitrary completions.
- Mind onboarding (`/minds/new`): 4-step flow — name → purpose → primer → review/edit generated system prompt. Skip & save available from any step (after name is filled).
- Minds list (`/minds`): all Minds the user belongs to, with inline system prompt editor per card.
- Dashboard "+ New Mind" link in the toolbar.
- Smart Spaces concept removed from the codebase entirely (Are.na-aligned).

**What it touches:**
- `supabase/spaces_v2_patch.sql`, `supabase/spaces_v2_query_optional_patch.sql`, `supabase/minds_v1_patch.sql` (incremental migrations as the model evolved)
- `src/lib/llm/` (provider-agnostic adapter)
- `src/lib/minds-prompts.ts` (base ethos + meta-prompt)
- `src/lib/permissions.ts` (`userCan`, `assertCan`, `getUserPermissions`)
- `src/app/api/workspaces/route.ts` + `src/app/api/workspaces/generate-prompt/route.ts`
- `src/app/minds/page.tsx` + `src/app/minds/new/page.tsx`
- `src/app/dashboard/page.tsx` (+ New Mind link)
- `src/components/app-nav.tsx` (Smart Spaces nav link replaced with Minds)

**Test plan:**
- [ ] Create a new Mind via onboarding; verify generated prompt is editable and saved
- [ ] Create a new Mind via skip path; verify generic prompt is applied
- [ ] Edit a Mind's prompt later from `/minds`; verify it persists and that non-admins without `manage_mind` are blocked
- [ ] After creating a Mind, the dashboard switches to it automatically (via `muttmind:active-mind-id` localStorage signal)

**Success:** A user can spin up a new Mind in under a minute (skip path) or with a tailored prompt in under three minutes (onboarding path). The dashboard's Mind dropdown is the everyday switcher.

---

### Feature 1.5 — Manual collection ("Connect to Mind")

**Branch:** `feature/manual-collection`

**Scope:** Are.na-style explicit collection. A capture is currently bound to one Mind. This feature lets the same capture live in many Minds without duplication — like Are.na "blocks" connecting to multiple channels.

- Schema: `node_workspaces(node_id, workspace_id, added_by, added_at)` junction table with PK on `(node_id, workspace_id)`. The capture's "home" workspace stays on `nodes.workspace_id` for backward-compat; the junction tracks additional Mind memberships.
- Dashboard / drawer affordance: "Connect to Mind" button on a capture, opens a picker of the user's Minds.
- A capture appears in every Mind it's connected to, with a small indicator on whether it's "from here" (this Mind is its home) or "connected from elsewhere."
- Disconnecting a capture from a Mind doesn't delete it; deleting from its home Mind cascades to all connections.

**Test plan:**
- [ ] From a capture's drawer, connect it to a second Mind; verify it appears there too
- [ ] Connect the same capture to three Minds; verify it shows in all three with no duplication of the underlying node
- [ ] Disconnect from a non-home Mind; verify it disappears from that Mind only
- [ ] Delete from the home Mind; verify it disappears from all connected Minds

**Success:** A capture can deliberately live in multiple Minds, the way an Are.na block connects to multiple channels.

---

### Feature 2 — Cosine-based graph edges (cleanup)

**Branch:** `feature/cosine-graph`

**Scope:**
- Replace `buildSemanticLinkPairs` keyword-match heuristic with a per-workspace adjacency endpoint that uses cosine over the embeddings already stored.
- Threshold + max-edges-per-node configurable (default: cosine ≥ 0.78, top 4 per node).
- Surface in the existing graph view with no UX change beyond "edges now mean something."

**Test plan:**
- [ ] Open `/vault` graph; verify edges look more meaningful than before
- [ ] Spot-check 5 edges — each should reflect actual conceptual similarity
- [ ] Verify performance acceptable for ≥200 nodes

**Success:** The graph stops lying. A user can navigate by following resonance, not by following hostnames.

---

### Feature 3 — Inward synthesis (corpus-only essays)

**Branch:** `feature/synthesis-inward`

**Scope:**
- New `essays` table: `id, workspace_id, smart_space_id, title, body_md, source_node_ids uuid[], mode_type, trail jsonb, created_at`.
- New `/api/essays` POST: takes a Space id, runs the mode to gather 8–20 nodes, sends to the Space's configured LLM with the Space's system prompt + voice source.
- Inline citation: every claim links back to a source node by id (rendered as a hover-card or footnote in the web view).
- Essay rendered as a new node in the corpus with `source = 'essay_derived'` and `derives_from` edges to its source nodes (recursion). This makes today's essay tomorrow's possible source.
- Trigger from Space view ("Synthesize") and from API (for later cron use).

**Test plan:**
- [ ] Generate an essay from a Space with ≥10 nodes; verify quality, voice, citations
- [ ] Verify the essay appears as a new node with `derives_from` edges
- [ ] Generate from a Space with only 3 nodes; verify the prompt acknowledges sparsity rather than confabulating
- [ ] Re-run synthesis; verify second essay can draw from the first

**Success:** A user clicks "Synthesize" and gets back a 600–1200 word essay that reads like their voice (or the prompt they wrote), with every claim traceable.

---

### Feature 3.5 — Mind memory layer

**Branch:** `feature/mind-memory`

**Scope:** Per-Mind persistent memory the synthesis agent can read from and write to over time. Without this, every essay is one-shot and the agent never accumulates a sense of what the Mind has been about.

Architecture in three layers:

- **Soul** — the Mind's `system_prompt` (already exists from Feature 1). Static, deliberately edited.
- **Memory** — new `mind_memory` table; the LLM writes salient facts and observations here, reads them as context on every synthesis run.
- **Corpus** — the captures themselves (already exist).

Schema:

```sql
create table public.mind_memory (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('fact', 'essay_summary', 'observation')),
  content text not null,
  embedding vector(768),
  source_node_id uuid references public.nodes(id) on delete set null,
  source_essay_id uuid references public.essays(id) on delete set null,
  weight float not null default 1.0,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
```

Three loops keep memory current:

1. **At capture time** — embedding update naturally shifts the Mind's centroid; no LLM call.
2. **Weekly extraction** — small LLM pass over the week's new captures + current memory; emits new facts to add and stale ones to invalidate. ~1 LLM call per Mind per week.
3. **At synthesis time** — top-N memory entries (by recency × cosine relevance) join the prompt context.

Per-Mind, memory is **shared** — a Shared Mind has one memory authored across all members. That's the move that earns the "Shared" in Shared Mind.

Inspired by [MemPalace](https://github.com/MemPalace/mempalace) but scoped per-Mind rather than per-user.

**Test plan:**
- [ ] Generate an essay; verify a brief memory entry is written for it
- [ ] Run synthesis a second time; verify the new prompt includes recent memory
- [ ] Trigger weekly extraction manually; verify new facts surface in memory
- [ ] In a Shared Mind, two members generate essays; verify both contribute to the same shared memory
- [ ] Edit/delete a memory entry from settings; verify it stops appearing in synthesis prompts

**Why this slot:** Synthesis (Feature 3) needs to ship first to know what memory is most worth holding onto. Memory then sits between Feature 3 and Feature 4 (Telegram digest) so that delivered essays already feel like the Mind is *learning* about itself.

---

### Feature 3.7 — "Find or ask" — search + chat unified

**Branch:** `feature/find-or-ask`

**Scope:** The global search input becomes both retrieval and question-answering. Same field, two behaviors decided by intent:

- Plain query (`Jevons paradox`) → semantic search across captures + memory; results dropdown.
- Question (`what's the through-line of what I've saved on AI safety?`) → routes to LLM with retrieved captures as context; streams an answer.

Detect intent simply: presence of `?` OR question-like prefix (`what`, `how`, `why`, `should I`, etc.). Otherwise, surface a small "Ask instead" toggle in the results dropdown.

The answer view:
- Short LLM response with **inline citations** linking back to source captures
- Below: the matching captures themselves, so the user can drop into the corpus
- Saved to a `mind_questions` log so the user can revisit / share / fork their queries

**Why this is critical:** the daydream essay (Feature 3) is the periodic event; "find or ask" is the everyday move. Bates' berrypicking is exactly this — query evolves as you find things. Without it, the synthesis loop is too slow to feel useful in the moment.

Lands after Feature 3 (synthesis exists) and Feature 3.5 (memory exists), since both are needed to answer well.

---

### Feature 3.8 — Per-capture Insight Lenses

**Branch:** `feature/insight-lenses`

**Scope:** A small palette of interpretive lenses applied to a single capture. Click a sparkle on any capture, get a popover menu of fixed prompts that each re-interpret the source through a different frame.

Initial lens set (mirrors Sublime's, plus our additions):

| Lens | Prompt shape | Output |
|---|---|---|
| **The Gist** | "What's the one-paragraph essence?" | 80-word condensation |
| **Explain Like I'm 5** | "Re-explain this for an intelligent twelve-year-old." | Plain-language version |
| **Contrarian Take** | "Steelman the opposite. What would a thoughtful skeptic say?" | Counter-argument |
| **Analogy** | "Find a non-obvious analogy that makes this idea click." | One sharp analogy |
| **Hot Take** | "What's the punchy, opinionated, one-line take on this?" | Tweet-length opinion |
| **Why I might have saved this** | (uses the Mind's system prompt + capture context) | Inferred relevance to the user's stated focus |
| **What's missing** | (looks at corpus + this capture) | What this source doesn't address that the Mind would want |

Each lens is a small prompt template — lives in `src/lib/lens-prompts.ts`. Output renders inline below the capture, persisted to a `node_lens_outputs` table so re-running gives the same result unless explicitly regenerated.

**Per-Mind controls:**
- Soft cap on free-tier lens runs per week (Sublime gates with "10 insights left. Unlock unlimited.")
- Lens outputs become candidate **memory entries** (Feature 3.5) — the most-used lens results bubble into the Mind's running memory.

**Why this matters as its own feature, not just part of synthesis:**
- Different shape than the essay (Feature 3): essay = across-corpus synthesis with author voice. Lenses = depth on a single source through many frames. **Same source, many berries.** Direct expression of Bates' insight that the same item rewards multiple modes of looking.
- Cheap and predictable per-call vs. essay's bigger lift.
- The per-capture sparkle is a powerful affordance — every capture becomes a small thinking partner.

Lands after Feature 3 (synthesis pipeline exists, prompts/voice live) and before Feature 4 (digests). The lens results enrich what the digest can summarize.

---

### Feature 4 — Telegram delivery (weekly digest)

**Branch:** `feature/telegram-digest`

**Scope:**
- Vercel Cron weekly per Mind (configurable cadence per Space).
- Cron picks active Space(s), runs synthesis, posts essay to Mind members' Telegram with a short preview + "View full" deep link to web.
- Per-member opt-in / snooze in settings.
- Telegram command `/digest now` for ad-hoc generation.

**Test plan:**
- [ ] Trigger weekly cron manually; verify essay arrives on Telegram with preview + link
- [ ] Snooze digest from Telegram; verify next cycle skips that user
- [ ] Run `/digest now`; verify ad-hoc essay arrives

**Success:** Closed-loop. You save in Telegram all week, and Telegram tells you what your Mind noticed on Friday.

---

### Feature 5 — Candidates queue (manual + synthesis-suggested)

**Branch:** `feature/candidates-queue`

**Scope:**
- New `candidates` table: `id, workspace_id, url, title, og_image_url, suggested_by ('essay'/'feed'/'manual'), suggested_by_essay_id?, suggested_by_feed_id?, reason, source_search, status ('pending'/'approved'/'rejected'/'asked'), created_at`.
- Synthesis prompt extended with optional second pass: "propose 3–5 candidate links the user might want to investigate, with one-line rationale each." (Sources here come from the LLM's training; v6 will add real search.)
- Pre-fetch validation: every candidate URL is fetched server-side and metadata extracted before showing — no hallucinated URLs reach the queue.
- Web view: `/candidates` — list with approve/reject/ask-why per item.
- Telegram: candidates from this week's essay arrive as inline-keyboard messages: ✓ Add / ✗ Skip / 💬 Why?
- Approving a candidate runs the standard capture pipeline with `source = 'candidate_approved'` and `derives_from` edge to the originating essay.

**Test plan:**
- [ ] Generate an essay that yields candidates; verify they appear in `/candidates`
- [ ] Approve from web; verify it enters the corpus with correct source
- [ ] Approve from Telegram; verify same
- [ ] Reject from Telegram; verify it disappears from queue
- [ ] Ask-why from Telegram; verify rationale comes back as a reply
- [ ] Confirm pre-fetch validation drops bad URLs

**Success:** Approving a suggested link is a one-tap motion in Telegram, and the Mind grows from sources you didn't have to find yourself.

---

### Feature 6 — Wikipedia + free-source scouting

**Branch:** `feature/wikipedia-scouting`

**Scope:**
- A `searchExternalSources` adapter with first implementation hitting Wikipedia REST API (free, well-indexed).
- Synthesis prompt second pass switches from "propose from training data" to "search these sources, propose from results": Wikipedia first, then arXiv (free), then HN search (free).
- Per-Space toggle: external scouting on/off, source allowlist, max candidates per essay.
- All candidates still gated through the candidates queue.
- A small badge in the queue showing where each candidate came from.

**Test plan:**
- [ ] Generate essay with Wikipedia scouting on; verify candidates are real Wikipedia URLs
- [ ] Toggle scouting off; verify no external candidates appear
- [ ] Toggle arXiv on for an AI-research Space; verify arXiv papers surface
- [ ] Verify weekly cost stays within configured budget

**Success:** The Mind starts surfacing things you didn't save yourself, without burning tokens.

---

### Feature 7 — Feeds (subscriptions)

**Branch:** `feature/feeds`

**Scope:**
- Schema: `feeds` table — `workspace_id, type, config jsonb, filters, cadence, last_polled_at, enabled, daily_cap, dedup_seen_urls jsonb`.
- v1 source types: RSS / Atom, Hacker News (Algolia API), arXiv, Reddit, X (using existing bearer), Custom URL.
- Polling: Vercel Cron every 30 min (configurable) per feed, batched.
- **Relevance gate:** each new item is embedded → cosine vs. Mind/Space centroid → above threshold goes to candidates queue, below silently dropped.
- Daily per-feed cap to prevent flooding.
- Cold-start: in the first week of a new feed, surface a fixed sample (no gating) so the centroid has training data.
- **Dedup:** URL normalization (strip utm + fragment + mobile prefixes) + content-hash check.
- Per-feed kill switch on Telegram (`/feeds` lists with tap-to-pause) and web settings.

**Test plan:**
- [ ] Subscribe to a known RSS feed; verify items poll and gate correctly
- [ ] Subscribe to HN with a topic; verify only relevant items reach the queue
- [ ] Pause a feed from Telegram; verify polling stops
- [ ] Verify dedup: save a known URL, then have a feed surface it; should not double-add

**Success:** The Mind grows passively, even when you're not looking — but the candidates queue stays manageable.

---

### Feature 8 — Voice modes (system_prompt / user_notes / multi_user_notes)

**Branch:** `feature/voice-modes`

**Scope:**
- Voice picker per Space: `system_prompt` (existing default), `user_notes` (single user's notes as voice signal), `mind_notes` (multiple users' notes blended).
- Consent: a user setting `allow_voice_use: bool` — if false, that user's notes can't be selected for voice by anyone else.
- Synthesis prompt extended with a "match this voice" section + few-shot from the chosen notes.
- UI: voice picker in the Space settings, with a "Preview" button that runs a short synthesis sample.

**Test plan:**
- [ ] Generate essay with system_prompt voice; verify follows prompt
- [ ] Switch to user_notes (own); verify essay sounds like the user's notes
- [ ] Switch to mind_notes with multiple users; verify blend works
- [ ] Try to select another user without their consent; verify blocked

**Success:** A user can choose whose voice the Mind synthesizes in, with consent.

---

### Feature 9 — BYO LLM expansion

**Branch:** `feature/byo-llm`

**Scope:**
- **Workspace-level API keys (primary):** add `provider_keys` per workspace — Gemini / Anthropic / OpenAI / OpenRouter. Encrypted at rest. Admins or members with `manage_api_keys` permission can set/edit.
- **Per-user keys (opt-in):** workspace setting `allow_per_user_keys: bool` (default off, admin-toggled). When on, members can set their own key in personal settings, which overrides the workspace key for that member's actions.
- New permission key `manage_api_keys` added to the Feature 1 enum.
- Per-Space provider + model picker (plumbed in Feature 1, now exposed).
- Usage tracking: per-user / per-Mind token + cost counters in settings.
- Hosted Gemini default remains for any workspace without a configured key.

**Test plan:**
- [ ] Admin sets a workspace Claude key; verify synthesis in any Space uses it
- [ ] Admin grants member `manage_api_keys`; verify that member can change the key
- [ ] Member without `manage_api_keys` cannot see/change the key
- [ ] Admin enables `allow_per_user_keys`; member sets their own OpenAI key; verify their actions use that key while others still use the workspace key
- [ ] Disable `allow_per_user_keys`; verify members fall back to workspace key
- [ ] Verify Gemini hosted default still works for a workspace with no keys configured
- [ ] Verify usage counters increment per user and per workspace

**Success:** Workspaces can pick their LLM and pay their own bill; admins control by default; per-member overrides exist when needed.

---

### Feature 10 — Newsletter generation (mechanics TBD)

**Branch:** `feature/newsletter`

**Scope:** TBD — to be designed when we get here. Likely: a Space-level "Newsletter" output type with a different template, intro/outro structure, optional cover image, and an export-to-email path (or share-as-link). Distinct from internal digests.

---

## Cross-cutting work (in parallel where reasonable)

- **UI audit pass.** Once Feature 1 ships, audit `/dashboard`, `/vault`, `/minds`, `/login`, `/telegram`, `/invite/[token]` for visual consistency, mobile usability, and dead-state empties. No new features — just polish.
- **Capture-time provenance.** Add the `source` field migration alongside Feature 1 so every later feature can rely on it.
- **Telegram bot UX.** Where new commands are added, prefer inline keyboards over typed slash-commands so users don't memorize.

## Pricing / sustainability reference

Are.na's pricing — ~$70/yr standard, ~$120/yr patron — is the reference point for MuttMind's eventual paid tier. Implications for architecture, even before any pricing UI lands:

- Storage decisions (og:image hosting, eventual PDF storage, embedding storage) should pencil out against ~$70/yr/user revenue, not free-tier assumptions.
- Make per-user / per-Mind storage and LLM cost measurable from day one — instrument early so we can later set tiers honestly.
- A "patron" tier ($120-ish) is a useful concept to borrow: power users who get early access to new features.
- Member-supported, no ads, no data resale. Match Are.na's positioning.

This is a future / not-now consideration. No pricing UI work yet — just keep the architecture honest about real costs.

## Competitive intel — Sublime

[Sublime](https://sublime.app) is the closest competitor: also a curation-meets-light-PKM tool with explicit AI features. Their compare-with-Are.na page positions them as "Are.na with AI." What they do that's different and what we should do about it:

| Sublime move | Our response |
|---|---|
| Heavy **Chrome extension** that pulls full article body + images, one-click save, right-click on any image | **Promote browser extension from `future / not-now` to a real planned feature** (see below). Telegram is great mobile-first but desktop reading happens in browsers. |
| **Ctrl+R "Related" hotkey** on selected text — shows related cards from your library + public Sublime universe at the moment of reading | Adopt the *shape*. When you save in Telegram, the bot replies *"this looks related to N things in your Mind already"* with thumbnails. Slots into the candidates queue (Feature 5). |
| **Canvas** spatial workspace for synthesis | **Don't build.** Spatial whiteboard is a feature trap; our edge is conversational synthesis across multi-person Minds, not spatial arrangement. |
| **Cross-user AI surfacing** from public collections ("Sublime universe") | Watch, don't chase. We have a structural advantage (Minds are already multi-participant); the equivalent for us is cross-Mind synthesis suggestions. v2 territory, after single-Mind synthesis is excellent. |
| **Annotations per card** (Are.na blocks are metadata-only) | Already true for us — captures have `user_notes` + a notes log. |

### New near-term feature: Browser extension (capture + related-cards rail)

**Branch:** `feature/browser-extension`

**Scope:** A Chromium extension that does two distinct things on the open web. Capture is the entry; the related-cards rail is the loop that makes the Mind feel alive.

**Part A — Capture (one-click save anywhere):**
- Toolbar icon: click to save current tab. Pulls title, full article body, og:image, author.
- Right-click any image: "Save image to MuttMind."
- Highlight + right-click: "Save quote to MuttMind" (quote becomes the capture's content; URL becomes its source).
- Region screenshot: "Save screenshot to MuttMind" (handles paywalled / dynamic content).
- Save panel shows: thumbnail preview, note field, Mind picker (defaults to last-used), Favorite + Private toggles.
- Auth via long-lived token issued from MuttMind settings.

**Part B — Related-cards rail (the unlock):**
- A right-rail panel that opens on any webpage. Shows captures from your active Mind that are semantically related to what you're currently reading (cosine similarity vs. the page's extracted text).
- Trigger: a small floating chip in the page's gutter, OR keyboard shortcut (Cmd+Shift+R), OR highlight-to-show on selected text.
- Each related card shows og:image + title + which Mind it came from + when it was saved.
- Click a card → open it in a MuttMind drawer (in-page overlay) without leaving the current site.
- The whole point: browse the open web, your Mind shows up alongside as context. Reading and synthesis become one motion instead of two.

This should land **after** Feature 1 (Minds foundation) is fully merged and **before** Feature 7 (Feeds), since the extension partially obviates feeds for power users.

**Why both parts in one feature:** Capture-only loses to Sublime's complete loop. Related-cards-only is a half-built reader. Both together = a desktop reading surface that always knows what your Mind already contains.

## UX polish backlog (gathered intel, slot into chunks as we get there)

- **Empty Mind state — inviter, not void.** Today it's a small composer with placeholder text. Should be three big centered actions: **Paste link / Write / Upload**, plus a secondary line *"not sure where to start? pick from a starter Mind."* Modeled on Sublime's first-save screen. Lands in dashboard polish (after vault rewrite).
- **Capture surface — link is the hero, structure is opt-in.** Sublime's pre-save state shows just the pasted link with og:image inline; chip-style optional actions (`+ Add note` / `# Add to Mind` / `★ Favorite` / `🔒 Private`) appear below only after paste. Big `Save` in the corner. Don't show every field at once — let the user opt into structure. Worth refactoring our capture composer toward this.
- **Post-save toast** — subtle "Saved to your library — View — ×" auto-dismissing toast top-right after save. Confirms without breaking flow.
- **Activation-checklist widget.** Persistent dismissible "Finish setup" panel that tracks activation milestones: ✓ Create first Mind / Save first capture / Connect Telegram / Tailor assistant / Invite collaborator / Generate first synthesis. Real growth-product pattern. Re-openable from account settings.
- **Starter Minds / Staff Picks.** Curated example Minds users can clone or browse to see what a mature Mind looks like. Promotes the cold-start path from buried to surfaced. Slots in alongside the empty-state work.
- **Upload as a capture path.** Files, PDFs, images. Currently we only handle URLs + text. The empty-state inviter should at least foreshadow this even before the underlying handling is built. Real implementation lands with Multi-modal corpus (future).
- **Persistent install affordances** in the corners (browser extension, iOS app) — surface entry points users would otherwise never find. Lands once those exist.

## Imports / Connectors (strategic feature category)

Sublime treats each external source as a first-class sidebar item: Kindle, Readwise, X Bookmarks, Instagram saves, Podcast Magic. They're not asking users to manually add — they hook into where users already read/save/listen. This is a much bigger surface area than "browser extension" and a real moat once built up.

Worth treating as a category of related features rather than one feature. Each connector is a one-time setup that then trickles content into the Mind on a schedule. Overlaps but doesn't replace **Feature 7 (Feeds)** — feeds are public/discovery, connectors are personal/already-saved.

**Two paths to ingest, depending on the source's API surface:**
- **API-based** (Reddit, X, Readwise, Pocket): OAuth or token, sync runs server-side. Cleanest.
- **Extension-as-scraper** (Instagram, sites with no API): the browser extension runs in the user's authenticated session and harvests their saved/bookmarked content, then posts to MuttMind. This is what Sublime does for Instagram. **Locks the browser extension as foundational infrastructure for the whole connector strategy** — it's not just a capture surface, it's also the only way to get inside walled gardens.

Initial integrations worth scoping (in priority order — Pete called out X Bookmarks + Reddit saves as top must-haves):

| Connector | Path | Notes |
|---|---|---|
| **X / Twitter Bookmarks** ⭐ | API (bearer token) | Already partially scoped via X enrichment. Top priority. |
| **Reddit saves** ⭐ | API (OAuth) | Top priority. Rate-limited but workable. |
| **Readwise** | API (OAuth) | Free tier user export; rich highlights from books, articles, tweets, podcasts. Hugely additive. |
| **Pocket / Instapaper / Raindrop** | API or CSV | The "saved-for-later" export. Cold-start gold. |
| **Kindle highlights** | via Readwise OR CSV | Same data via either path. |
| **Instagram saves** | extension-scraper | Sublime's exact approach — needs the browser extension running in the user's IG session. |
| **LinkedIn saves** | extension-scraper | Same pattern as Instagram. |
| **Podcast transcripts** | Whisper + RSS scrape | Big lift; defer to v2. |

Lands as **Feature 8.5 — Connectors** alongside or after Feature 7 (Feeds). Each connector ships individually; they're independent. The extension-scraper connectors **depend on the browser extension being shipped first**.

## Known gaps — must address

- **Member removal from Shared Minds.** There is currently NO way to remove or
  kick a member. The members API only has GET + invite (POST); no DELETE. This
  is a real safety/privacy gap for shared workspaces — someone invited can
  never be removed. Needs: `DELETE /api/members` (owner/admin or
  `manage_members` permission), a confirm step, RLS-safe deletion of the
  `workspace_members` row, and a "Remove" affordance per member in per-Mind
  settings. Owners can't be removed; admins can remove members; last owner
  guard. **Prioritize before any external launch.**

## Future / not-now

- Local LLM (Ollama) provider
- Slack / Discord ingestion (in addition to Telegram)
- Browser extension for capture
- Public Mind sharing (read-only)
- Per-essay reactions and threads
- Imports: Pocket / Instapaper / Raindrop / Twitter bookmarks / Readwise CSV
- iOS/Android share-sheet capture
- Multi-modal corpus (PDFs with OCR, YouTube with timestamps, podcast transcripts)

## Workflow rules

1. One feature, one branch, one approval gate.
2. No feature is merged to main without the user testing it and approving.
3. Every feature has an explicit test plan that the user runs before approval.
4. New schema changes are reversible migrations, with both up and down provided.
5. Cost-impacting changes (anything that calls an external LLM or paid API) ship behind per-Mind defaults that lean toward the cheap path.
6. Telegram and web UX always evolve in lockstep where the action overlaps.
