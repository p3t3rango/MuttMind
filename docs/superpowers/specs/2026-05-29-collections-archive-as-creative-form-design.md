# Collections — Archive as creative form

Date: 2026-05-29
Status: design — awaiting user review

## Context

MuttMind today is optimized for *gather → AI organizes → retrieve/synthesize.* The
material is treated as input for the assistant; almost every layer of structure
(tags, summaries, syntheses, the map, "learned" insights) is machine-authored.
The user can capture and find, but cannot deliberately **arrange, compose, or
present** their material as an authored artifact.

The "Designing Digital Records" workshop (index-space) reframes archives as a
**creative form**: arrangement *is* meaning; hierarchy/layout/views are a
**visual language**; the curator's authority over framing is the work. Are.na —
the stated north star — is exactly that thesis in product form. MuttMind has
drifted toward "AI librarian"; this initiative is the corrective — the user as
*curator*, the archive as *expression*.

Collections is the layer that adds **curation-as-authorship**, **multiple
expressive views**, **publication as exhibit**, and **situated time** (dual
dates: original vs shared) — answering #1, #2, #4, and #3 from the workshop
reflection.

## Core concept

Minds remain the **gathering** space (capture, search, chat). A **Collection**
is an **authored, presentable artifact** the user composes from captures —
within or across Minds — and publishes as an exhibit. A Collection **references**
captures (never moves or duplicates them); one capture can appear in many.

### Design principles
- **Curation as authorship.** Arrangement, sequence, captions, and text blocks
  are the curator's work. The product gives them a real composing surface.
- **AI proposes, the user owns.** The assistant never edits Collections; it can
  *suggest* (future), but the curator authors.
- **Authored above lensed.** Editorial is the canonical view; other views are
  re-presentations of the same captures, not replacements for the authorship.
- **Curate private; publish public.** Editing is private (owner-only). Publishing
  produces an *unlisted* public URL — no login, no discovery surface, no public
  profile in v1.
- **Reference, don't copy.** Items reference capture rows; deleting a capture
  shows it as orphaned in the editor and is hidden from the public exhibit.

## Data model

New tables:

- **`collections`**: `id`, `owner_user_id`, `title`, `description`,
  `cover_path` (signed image in `captures` bucket, nullable),
  `default_view` (`'editorial'`), `enabled_views` (text[] from
  `{'editorial','gallery','timeline'}`, must include `'editorial'`),
  `show_summary` (bool, default false), `show_tags` (bool, default false),
  `show_notes` (bool, default false) — public-exhibit opt-ins,
  `status` (`'draft' | 'published'`), `share_code` (unique, minted on publish),
  `created_at`, `updated_at`.
- **`collection_items`**: `id`, `collection_id`, `position` (int, contiguous),
  `kind` (`'capture' | 'text'`), `node_id` (uuid, nullable, **FK on
  `nodes(id) ON DELETE SET NULL`** so a deleted capture becomes an orphan
  instead of cascading the item away), `caption` (text, nullable; **plain
  text + line breaks, escaped on render**; only meaningful for captures),
  `text_body` (text, nullable; **plain text + line breaks, escaped on
  render**; required when `kind='text'`), `created_at`. *Markdown deferred —
  the public exhibit is an XSS surface, so plain text keeps v1 safe without a
  sanitizer.*
- **`nodes.published_at`** (timestamptz, nullable) — the *original*
  published/created date of the source. `nodes.created_at` (existing) remains the
  *shared* date.
- **`workspaces.allow_member_cross_publish`** (bool, default false) — Shared
  Mind owner toggle, surfaced in that Mind's Settings. When false, members can
  include only their own captures from this Mind in personal Collections; when
  true, members may include any capture from this Mind. Enforced on add (the
  editor blocks it) and re-validated on every public-exhibit render so the
  setting can be revoked.

Cross-Mind reads: when the editor lists items, it joins to `nodes` and only
returns nodes whose `workspace_id` is one the **owner** belongs to (recheck on
every read — membership can change). The public exhibit (`/c/<code>`) reads a
denormalized projection (see "Publish").

## Building a Collection (the editor)

A new editor surface per Collection — owner-only. Operations:

- **Add captures** from three entry points: a capture's drawer ("**Add to
  Collection ↗**"), board **multi-select** ("Add to Collection"), and **search
  results** ("Add to Collection" per row — **capture results only; the action
  is disabled on insight results in v1** because `'insight'` is not a
  Collection item kind).
- **Reorder** items by drag.
- **Insert text blocks** between items (headings, intros, connective prose).
- **Caption** a capture *for this Collection* (without touching the underlying
  node).
- **Cover** image (optional) — **pick from any item capture's `og_image` /
  uploaded image**, OR upload a new image via the existing direct-to-storage
  flow.
- **Enabled lenses** — toggle Gallery / Timeline on for this Collection (Editorial
  is always on; the curator can't disable it).
- **Orphans:** items whose underlying capture was deleted show
  "(removed — keep or delete)" in the editor; auto-hidden in the public exhibit.

## Views

The same items render in different visual languages. Editorial is canonical and
preserves authorship; alternate lenses are re-presentations.

- **Editorial (canonical default).** Single-column, top-to-bottom reading.
  Capture items render as a card + caption inline; text blocks render as prose
  between them. The curator's sequence is the narrative.
- **Gallery (optional lens).** Masonry/grid of the captures (captions below/on
  hover); text blocks become full-width section headings. Curator order
  preserved; the visual carries it.
- **Timeline (optional lens).** Captures arranged along a date spine
  (`published_at`, falling back to `created_at`); text blocks become
  date-anchored annotations (placed at the chronological position they sit in
  the editorial sequence). The visitor can toggle between *published* and
  *shared* date axes.

A visitor on a published Collection sees a small **view switcher** offering only
the lenses the curator enabled.

## Publish

States: **Draft** (owner-only, editable) → **Published** (read-only public URL).

- Publishing mints a `share_code` if absent and exposes `/c/<code>` — a public,
  unlisted, read-only exhibit page. No login required.
- The exhibit renders the **curated projection** of each item: title, the
  capture's `og_image` (if any) or a preview, the curator's `caption`, the
  source `original_url` (if any), `published_at` (if any), and any text blocks.
  The curator can **opt in per Collection** to additionally surface each
  capture's AI **summary**, **tags**, and/or **user notes** via the three
  `show_*` booleans on the Collection. **`raw_text` is never exposed** (it
  could be an entire article/PDF), and insights are never exposed (they're not
  Collection items).
- **Live updates.** A published Collection reflects subsequent edits (no
  version snapshots in v1). Unpublish hides it; the share_code is preserved so
  re-publishing reuses the URL.
- **Private-bucket assets.** Cover image, item images, and any PDFs live in the
  **private `captures`** bucket. The public exhibit **re-signs short-lived URLs
  at render time** per request (mirroring the existing `/api/nodes` pattern);
  a tab left open eventually fetches fresh signed URLs on reload. v1 does not
  proxy media — visitors fetch directly from Supabase.
- **Unlisted means unindexed.** `/c/<code>` emits
  `<meta name="robots" content="noindex,nofollow">` and the response carries
  an `X-Robots-Tag: noindex,nofollow` header. Search engines don't surface it;
  only the link does.

## Dates (#3 — situating media in time)

A new `nodes.published_at` column captures *when the source was originally
published/created*, distinct from `nodes.created_at` (when it was shared into a
Mind). Extraction sources:

- **Articles/links:** `article:published_time` meta, `og:article:published_time`,
  JSON-LD `datePublished`, `<time datetime="">`, falling back to
  `Last-Modified` header. (Already scraped; extend the extractor.)
- **PDFs:** PDF document metadata `info.CreationDate` (available via the
  existing `unpdf` import) — extracted in `from-storage` at capture time.
- **Tweets / YouTube / oembed-able sources:** whatever the existing scraper
  surfaces.
- **Images, voice, plain notes:** none extractable; `published_at` stays null.
- **Manual edit** in the capture drawer (date input) always wins.
- **Backfill.** v1 = **per-capture reprocess on demand** (the existing
  `/api/nodes/[id]/reprocess` flow re-runs extraction including the date — the
  user clicks Reprocess on a capture and it gets a date). A mass-reprocess
  affordance (one-click backfill across all captures, or a slow background
  job) is a fast-follow.

Display: both dates on the capture card and drawer ("Published 1998 · Shared
2024"). The Timeline lens orders by `published_at` (falling back to
`created_at`), with a toggle to switch the axis.

## Information architecture placement

A new **top-level Collections** home (peer to the Minds grid), reachable from the
top bar:

- `/collections` — the **Collections home**: a grid of the user's Collections
  (draft + published), filterable, with "**New Collection**".
- `/collections/[id]` — the **editor** (owner-only).
- `/c/<code>` — the **public exhibit**.

`AppNav` gains a "Collections" link in the authed branch (alongside the brand
and search). The Mind sub-header is unchanged; nothing inside a Mind changes
except that capture surfaces gain an "**Add to Collection**" action.

## Build decomposition (each plan ships on its own)

1. **Dates (#3).** `nodes.published_at` column + extractor changes (articles +
   PDFs) + manual edit in the drawer + dual display + reprocess backfill.
   Lays the time dimension Timeline will use.
2. **Collections core.** Data model migration + `/collections` home + editor
   with the Editorial view + "Add to Collection" entry points (drawer + board
   multi-select + search-results). "Save Collection" but no public publish yet.
3. **Lenses.** Gallery + Timeline views + per-Collection `enabled_views` toggle
   + visitor view-switcher (will only be visible publicly after publish ships,
   but exists privately in the editor preview).
4. **Publish.** Draft/Published states + share_code minting + `/c/<code>`
   public exhibit + share UI in the editor.

## Decisions flagged for review

1. **Public exhibit data scope.** ✓ Resolved with user. Curated projection by
   default; the curator can **opt in per Collection** to additionally surface
   AI **summary**, **tags**, and/or **user notes** via three booleans on the
   Collection (`show_summary`, `show_tags`, `show_notes`). `raw_text` and
   insights are never exposed.
2. **Live updates vs published snapshots.** v1 is live-update (edits reflect on
   the public URL immediately). Confirm; snapshotting versions is a fast-follow.
3. **Single-owner editing.** Only the Collection's creator can edit (no
   co-curation in v1, even for captures from Shared Minds). Confirm.
4. **Image EXIF dates.** Image captures have no `published_at` in v1 (EXIF
   parsing deferred). Confirm.
5. **Shared-Mind publishing authority.** ✓ Resolved with user. Default is
   **own-captures-only** (`nodes.created_by = collection.owner_user_id`) for
   captures sourced from a Shared Mind. A new per-Mind owner setting
   **`workspaces.allow_member_cross_publish`** (surfaced in that Mind's
   Settings, default false) opts the Shared Mind in to allow any member to
   include any capture from it in personal Collections. Enforced at add-time
   in the editor and re-validated on every public-exhibit render so the
   setting can be revoked.

## Verification (per plan)

- **Dates:** new captures get `published_at` where extractable; reprocess
  backfills; manual edit persists; drawer + card show both; Timeline lens
  orders correctly with the axis toggle.
- **Collections core:** create a Collection; add captures from drawer, board
  multi-select, and search; reorder; insert text blocks; write captions; the
  editor renders the Editorial view correctly; cross-Mind items resolve only
  while owner is still a member.
- **Lenses:** enable Gallery/Timeline on a Collection; views render
  consistently; visitor switcher only shows enabled lenses.
- **Publish:** Draft never accessible publicly; Published `/c/<code>` is
  unlisted, read-only, exposes only the curated projection (no leakage of
  `raw_text`/notes/tags); Unpublish hides; re-publish reuses the share_code.

## Out of scope (parked)

- Public profile / discovery surface for Collections (option 3 in the publish
  decision).
- Co-curation / shared editing of Collections.
- Versioned publishing / snapshots.
- Embeddable Collection widget / oEmbed for external sites.
- AI-suggested Collections (the assistant proposing groupings).
- Image EXIF extraction for `published_at`.
