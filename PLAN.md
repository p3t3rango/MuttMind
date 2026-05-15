# MuttMind — Synthesis Engine Plan

> A staged plan to evolve MuttMind from a capture/curation tool into a *Shared Mind* — a low-friction, AI-augmented place where individuals or groups capture across the web, watch the Mind organize itself, and receive synthesis (essays, digests, suggested external sources) that helps them see patterns, reuse knowledge, and extend their thinking.

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
- Block-style thinking: a saved item ("node") can live in multiple Spaces without duplication. Already partly true via Smart Spaces; preserve in any new feature.
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

### Feature 1 — Spaces with system prompt + onboarding (foundation)

**Branch:** `feature/spaces-onboarding`

**Scope:**
- Schema:
  - Add `system_prompt`, `voice_source` (`system_prompt` | `user_notes` | `mind_notes`), `voice_user_ids uuid[]`, `mode_type` (`query` | `steep` | `voice` | `neighborhood` | `all`), `seed_node_id`, `seed_tag_id`, `seed_author`, `provider`, `model` to `smart_spaces`.
  - Add Mind-level defaults: `default_system_prompt`, `default_provider`, `default_model` to `workspaces`.
  - **Permissions system:**
    - New table `workspace_member_permissions(workspace_id, user_id, permission_key, granted_by, granted_at)`.
    - Initial enum of permission keys: `manage_spaces`, `manage_voice`, `manage_members`. Grows as later features land (`manage_api_keys` in Feature 9, `manage_feeds` in Feature 7).
    - Helper: `userCan(userId, workspaceId, permissionKey)` — returns true if user is owner/admin OR has the permission grant.
    - Members listing in settings shows current grants per member; admins can toggle.
- LLM adapter scaffolding:
  - Refactor `src/lib/llm.ts` to a provider-agnostic interface; keep Gemini as only exposed implementation in this feature.
  - Plumbing for per-Space provider/model is wired, but the picker is locked to Gemini.
- Onboarding UI: `/spaces/new`
  1. "What's this Space for?" (free text)
  2. "Anything specific you want to feed the assistant as priming context?" (optional free text)
  3. Optional preview of generated system prompt (LLM-generated from answers); editable
  4. Save Space (with mode_type defaulted to `query` for now)
- "Skip onboarding" path: creates Space with title + a generic default prompt; LLM bootstraps from title + future captures.
- Edit-anytime UI for the Space's system prompt under settings (gated by `manage_spaces` permission).

**What it touches:**
- `supabase/schema.sql` (migration)
- `src/lib/llm.ts` (refactor)
- `src/app/api/spaces/route.ts` (extend)
- `src/app/spaces/page.tsx` + new `src/app/spaces/new/page.tsx`
- `src/app/settings/page.tsx` (Space prompt editor)

**Test plan:**
- [ ] Create a new Space via onboarding; verify generated prompt is editable and saved
- [ ] Create a new Space via skip path; verify generic prompt and bootstrap works
- [ ] Edit a Space's prompt later from settings; verify it persists
- [ ] Verify Mind-level defaults apply when a Space prompt is empty

**Success:** A user can spin up a new Space in under a minute (skip path) or with a tailored prompt in under three minutes (onboarding path).

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

- **UI audit pass.** Once Feature 1 ships, audit `/dashboard`, `/vault`, `/spaces`, `/login`, `/telegram`, `/invite/[token]` for visual consistency, mobile usability, and dead-state empties. No new features — just polish.
- **Capture-time provenance.** Add the `source` field migration alongside Feature 1 so every later feature can rely on it.
- **Telegram bot UX.** Where new commands are added, prefer inline keyboards over typed slash-commands so users don't memorize.

## Pricing / sustainability reference

Are.na's pricing — ~$70/yr standard, ~$120/yr patron — is the reference point for MuttMind's eventual paid tier. Implications for architecture, even before any pricing UI lands:

- Storage decisions (og:image hosting, eventual PDF storage, embedding storage) should pencil out against ~$70/yr/user revenue, not free-tier assumptions.
- Make per-user / per-Mind storage and LLM cost measurable from day one — instrument early so we can later set tiers honestly.
- A "patron" tier ($120-ish) is a useful concept to borrow: power users who get early access to new features.
- Member-supported, no ads, no data resale. Match Are.na's positioning.

This is a future / not-now consideration. No pricing UI work yet — just keep the architecture honest about real costs.

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
