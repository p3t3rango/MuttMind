# Overnight build handoff

Branch: **`feature/minds-foundation`** — single consolidated branch you can test top to bottom.
Safety tag: **`checkpoint-overnight-start`** — the commit before tonight's batch. `git reset --hard checkpoint-overnight-start` undoes everything if needed.

Dev server is on **http://localhost:3001**.

---

## What you can test right now (UI-visible, no flags needed)

### 1. Vault — real force-directed graph (chunk 2D-ii)
`/vault` is a complete rewrite:
- d3-force simulation with charge + link + collide forces
- Pan: drag empty space. Zoom: scroll wheel (anchored to cursor). Drag a node to rearrange — the rest reflows.
- Hover any node → that node + its semantic neighbors stay full-opacity, the rest fade. Connecting edges stay bright.
- Click → opens a small detail panel (right side) with og:image, title, host, "Open in dashboard" / "Visit source" actions.
- Edges are real cosine similarity over the embeddings already in your DB (threshold 0.78, cap 4 edges per node). The old keyword-matching `buildSemanticLinkPairs` is gone.
- Empty/loading states are quiet centered text. Aesthetic matches the rest of the editorial restraint pass.
- Reads `?q=` from URL — global search fades non-matching nodes.

### 2. Login + landing redesigned (chunk 2D-iii)
- `/login` collapsed from the dual-column hero+panel layout into a single ~380px centered column. Mono tab toggle, hairline inputs.
- `/` (landing) is now a quiet single-column page — three numbered steps (Capture / Organize / Synthesize) on hairline rules, no display-chrome marketing copy.

### 3. Dashboard empty-state inviter
- When a Mind has zero captures, the dashboard renders a Sublime-style three-path inviter: **Paste link / Write a note / Upload (coming soon)** plus an "or save from anywhere — open the Telegram bot" line.
- Both Paste and Write focus the existing capture composer.

### 4. Activation checklist widget
- Floating "Finish setup" panel bottom-right of the dashboard, tracks five milestones:
  - Create your first Mind (auto)
  - Save your first capture (auto)
  - Tailor your assistant (manual + clickable)
  - Make it a Shared Mind (auto via member_count)
  - Connect the Telegram bot (manual + clickable)
- Dismissable (state in localStorage). Auto-hides when all complete.

### 5. Search input refinements
- Mind picker on dashboard is now a custom in-style dropdown (no more OS-default menu).
- Global search focus state is calmer (slower transition, lower-alpha border).
- "9 captures" no longer wraps — single line.

### 6. All pages now use a unified true-black background
- Replaced the blue-tinted `#111218` with `var(--paper)` (`#050505`) everywhere. Vault, dashboard, minds, settings, login, landing all share the same surface. Modal/panel surfaces (`#0a0a0a`) keep their tiny lift for depth.

---

## What's plumbed but gated (Tier 3 — code lands, no LLM call until you flip a switch)

These endpoints exist, return **503** with a hint message until the env var is set. Schemas are applied. UI surfaces NOT shipped — those are the next morning's design discussion.

| Feature | Endpoint | Env flag to enable | LLM cost per use |
|---|---|---|---|
| **Synthesis essays** (Feature 3) | `POST /api/essays` | `MUTTMIND_SYNTHESIS_ENABLED=1` | 1 completion |
| **Insight Lenses** (Feature 3.8) | `POST /api/nodes/{id}/lens` | `MUTTMIND_LENSES_ENABLED=1` | 1 completion (cached after first run per lens) |
| **Find or ask** (Feature 3.7) | `POST /api/ask` | `MUTTMIND_ASK_ENABLED=1` | 1 embed + 1 completion |

`GET` variants of all three are ungated and zero-cost (list cached output / list essays).

To enable any one of these, add the env var to `.env.local`, restart the dev server. They're independent — flip them one at a time.

---

## Schema migrations applied tonight

All applied via the Supabase CLI against the linked project. Each has a `ROLLBACK` block at the bottom of its file:

| Migration | Purpose |
|---|---|
| `supabase/workspaces_privacy_patch.sql` | `workspaces.privacy text` (open / closed / private) |
| `supabase/workspaces_description_patch.sql` | `workspaces.description text` |
| `supabase/permissions_rename_manage_spaces_patch.sql` | Permission key `manage_spaces` → `manage_mind` |
| `supabase/mind_memory_patch.sql` | `mind_memory` table (Feature 3.5) |
| `supabase/essays_patch.sql` | `essays` table (Feature 3) |
| `supabase/lens_outputs_patch.sql` | `node_lens_outputs` table (Feature 3.8) |

---

## Plan additions in PLAN.md tonight

While building, your iterative Sublime / Are.na intel landed in PLAN.md as new sections:

- **Feature 3.5** — Mind memory layer (now also has scaffolding shipped)
- **Feature 3.7** — Find or ask (search + chat unified, scaffolding shipped)
- **Feature 3.8** — Per-capture Insight Lenses (scaffolding shipped)
- **UX polish backlog** — Sublime-inspired empty-state inviter (shipped), capture chip-actions, post-save toast, activation checklist (shipped), starter Minds, upload, install affordances
- **Imports / Connectors** as a strategic feature category — X Bookmarks + Reddit saves marked top priority. Notes the extension-as-scraper pattern.
- **Browser extension** scope split into Part A (capture) + Part B (related-cards rail) — Part B is the killer surface from Sublime
- **Sublime competitive intel** — what to steal, reject, watch

---

## Commit order (most recent first)

```
43332d1  Find-or-ask scaffolding (Feature 3.7) — gated behind env flag
98d1318  Insight Lens scaffolding (Feature 3.8) — gated behind env flag
852d2c2  Synthesis essay endpoint scaffolding (Feature 3) — gated behind env flag
940d1e4  Mind memory layer (Feature 3.5) — schema + helpers, no LLM calls yet
0179133  Activation checklist widget — Sublime-style 'Finish setup' panel
a598301  Dashboard empty state: Sublime-style three-path inviter
8c63a85  Login + landing redesigned in editorial restraint (2D-iii)
a4978b0  Vault: rewrite with d3-force semantic graph (2D-ii)
2bffb32  Add d3-force + d3-zoom for force-directed vault graph
35c7215  Plan: add Feature 3.7 + 3.8                          ← checkpoint-overnight-start
```

Each commit is independently revertable via `git revert <sha>`.

---

## AI surfaces shipped (branch `feature/synthesis-ui`, off main)

The three gated AI features now have UI. All still dormant until their flag is set — the UI shows a clear "dormant, set X=1" card instead of erroring.

- **Synthesis essays** — `/minds/[id]/essays`. "Synthesize" button → essay reader (list + rendered markdown w/ citations). Flag: `MUTTMIND_SYNTHESIS_ENABLED=1`.
- **Insight Lenses** — in the capture drawer. Chip row (Gist / ELI5 / Contrarian / Analogy / Hot Take / Why I saved this / What's missing) → inline output. Flag: `MUTTMIND_LENSES_ENABLED=1`.
- **Ask this Mind** — `/minds/[id]/ask`. Question box → grounded answer + numbered citations. Flag: `MUTTMIND_ASK_ENABLED=1`.

All three reachable from per-Mind settings → Assistant section. New `EssayMarkdown` component renders synthesis/answer markdown safely (no dangerouslySetInnerHTML).

`feature/minds-foundation` was merged to `main` (`112d447`) and pushed. `feature/synthesis-ui` (AI surfaces) is separate, **not yet merged to main** — awaiting your test/approve.

## Post-handoff fixes (after you flagged issues in the morning)

- **Vault graph was useless → fixed.** Click was dead (every press read as a drag); now press = open node, drag = rearrange. Every node is labeled (Obsidian-style, centered below). Graph is much denser — cosine threshold 0.78 → 0.62, tag-shared edges added back, node size scales with connection count.
- **"Open in dashboard" from a graph node now actually opens that capture.** New `GET /api/nodes/{nodeId}` endpoint; dashboard consumes the `muttmind:focus-capture-id` signal and opens the drawer (works even for captures older than the recent slice).
- **Settings rebuilt as per-Mind** (`/minds/[id]/settings`) in editorial restraint — Identity / Assistant (Tailor + Privacy) / Members / Tags / Export. `/settings` is now a thin Mind-picker. `/minds` cards got a Settings link. This was the one page skipped in the original cascade.

## What's NOT done overnight (deliberately)

These were either out of scope, risky without your input, or LLM-costly:

- **No actual synthesis runs.** All three gated features (essays, lenses, ask) are dormant. I built the plumbing; running them is your call.
- **No UI for synthesis triggers.** The Generate / Sparkle / Ask buttons live in tomorrow's design discussion. Better to ship them once together with you in the loop.
- **No browser extension.** Separate codebase, separate auth flow. Big chunk on its own.
- **No Connectors** (Reddit, X bookmarks, etc.). Each is its own feature with auth and rate-limit complexity.
- **No push to origin.** Branches stay local. Push when you've reviewed and approved.

---

## To push (when ready)

```
# Push the safety backup branch (created earlier today)
git push origin main-backup-2026-05-14

# Push the consolidated feature branch
git push origin feature/minds-foundation

# Open a PR: feature/minds-foundation → main
gh pr create --base main --head feature/minds-foundation
```

Or just merge locally + push to main if you're satisfied without the PR step:
```
git checkout main
git merge feature/minds-foundation
git push origin main
```

---

## To revert anything

```
# Nuclear: undo everything since checkpoint
git reset --hard checkpoint-overnight-start

# Surgical: revert one specific commit
git revert <sha>
```
