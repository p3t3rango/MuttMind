# Dual Dates — `published_at` Implementation Plan (Collections #1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the *original* published/created date of each source as `nodes.published_at` — automatically from article meta tags and PDF document metadata, with a manual edit in the drawer; surface both dates on the capture (Published / Shared); and let the existing per-capture Reprocess flow backfill the field for older link captures.

**Architecture:** Two pure, vitest-covered extractors — `extractArticlePublishedAt(cheerio$)` and `parsePdfDate(string)` — slot into the existing `scrape.ts` (HTML pipeline) and `from-storage` route (PDF pipeline), set a new optional `publishedAt` on `ScrapeResult`/`Prefetched`, get persisted to a new `nodes.published_at` column via `captureSignal`'s existing insert, and surface on `/api/nodes` and the capture drawer. A new `PATCH /api/nodes/[nodeId]` provides manual edit + the save target for the drawer's datetime-local input.

**Tech Stack:** Next.js route handlers, Supabase admin client, `cheerio` (already a dep), `unpdf` (already used), vitest for the pure extractors.

**Spec:** `docs/superpowers/specs/2026-05-29-collections-archive-as-creative-form-design.md` (the Dates section).

**Out of scope (per spec):** image EXIF dates; mass-reprocess; the Collections layer itself (next plans).

---

## File map
- **Create** `supabase/nodes_published_at_patch.sql` — migration: add `nodes.published_at timestamptz`.
- **Modify** `src/lib/scrape.ts` — extract article published date; add `publishedAt` to `ScrapeResult`.
- **Create** `src/lib/scrape.test.ts` — vitest for the article-date extractor.
- **Modify** `src/app/api/capture/from-storage/route.ts` — read PDF metadata `CreationDate`; pass `publishedAt` into `captureSignal`'s `prefetched`.
- **Create** `src/lib/pdf-date.ts` — pure `parsePdfDate` helper.
- **Create** `src/lib/pdf-date.test.ts` — vitest.
- **Modify** `src/lib/capture.ts` — add `publishedAt?: string` to `Prefetched`; carry it through `scrape` into the `nodes.insert`.
- **Modify** `src/lib/reprocess.ts` — write the freshly-scraped `published_at` to the update.
- **Modify** `src/app/api/nodes/route.ts` — add `published_at` to SELECT + the response mapping.
- **Modify** `src/app/api/nodes/[nodeId]/route.ts` — add a `PATCH` handler that accepts `{ workspaceId, publishedAt }` (ISO or null) and updates the row, member-gated.
- **Modify** `src/app/minds/[id]/page.tsx` — Board's drawer: `CaptureItem.published_at`, dual display, datetime-local input + Save (PATCH).

Verification: vitest for the two extractors; `npm run build` + `npm run lint` for routes/UI; manual browser check on the drawer.

---

## Task 1: Migration — `nodes.published_at`

**Files:** Create `supabase/nodes_published_at_patch.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- The original published/created date of the source (article publish time,
-- PDF document creation date, manual override). Distinct from `created_at`,
-- which is when the capture was *shared* into the Mind.
alter table public.nodes
  add column if not exists published_at timestamptz;
```

- [ ] **Step 2: Apply against the dev DB**

Run the SQL via the Supabase SQL editor or `psql`. Expected:
`select column_name from information_schema.columns where table_schema='public' and table_name='nodes' and column_name='published_at';` returns `published_at`.

- [ ] **Step 3: Commit**

```bash
git add supabase/nodes_published_at_patch.sql
git commit -m "feat(db): add nodes.published_at (original date of the source)"
```

---

## Task 2: Article-date extractor — TDD

**Files:** Modify `src/lib/scrape.ts`; create `src/lib/scrape.test.ts`.

- [ ] **Step 1: Failing tests** — create `src/lib/scrape.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractArticlePublishedAt } from './scrape';

describe('extractArticlePublishedAt', () => {
  it('reads article:published_time meta', () => {
    const html = `<html><head><meta property="article:published_time" content="2023-06-15T12:34:56Z"></head></html>`;
    expect(extractArticlePublishedAt(html)).toBe('2023-06-15T12:34:56.000Z');
  });
  it('reads og:article:published_time', () => {
    const html = `<html><head><meta property="og:article:published_time" content="2024-01-02T03:04:05+05:00"></head></html>`;
    expect(extractArticlePublishedAt(html)).toBe('2024-01-01T22:04:05.000Z');
  });
  it('reads JSON-LD datePublished', () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Article","datePublished":"2020-11-30T08:00:00Z"}</script></head></html>`;
    expect(extractArticlePublishedAt(html)).toBe('2020-11-30T08:00:00.000Z');
  });
  it('reads <time datetime>', () => {
    const html = `<html><body><article><time datetime="2019-04-01">April 1</time></article></body></html>`;
    expect(extractArticlePublishedAt(html)).toBe('2019-04-01T00:00:00.000Z');
  });
  it('falls back to meta itemprop="datePublished"', () => {
    const html = `<html><body><meta itemprop="datePublished" content="2018-07-04T00:00:00Z"></body></html>`;
    expect(extractArticlePublishedAt(html)).toBe('2018-07-04T00:00:00.000Z');
  });
  it('returns undefined when no date is present', () => {
    expect(extractArticlePublishedAt('<html><head></head><body></body></html>')).toBeUndefined();
  });
  it('skips a malformed value and tries the next source', () => {
    const html = `
      <html><head>
        <meta property="article:published_time" content="not-a-date">
        <meta name="datePublished" content="2022-02-22T00:00:00Z">
      </head></html>`;
    expect(extractArticlePublishedAt(html)).toBe('2022-02-22T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run tests — FAIL** (`extractArticlePublishedAt` not exported).

Run: `npm run test`. Expected: failures referencing the missing export.

- [ ] **Step 3: Implement the extractor**

In `src/lib/scrape.ts`, add this exported helper near the top of the file (after the existing imports). It takes an HTML string and returns an ISO date string or `undefined`:

```ts
import { load as loadHtml, type CheerioAPI } from 'cheerio';

/**
 * Walk the conventional places a publish date hides in an article: standard
 * Open Graph / itemprop meta tags, JSON-LD `datePublished`, and the first
 * `<time datetime="…">`. Returns an ISO string; undefined if nothing parses.
 */
export function extractArticlePublishedAt(htmlOrCheerio: string | CheerioAPI): string | undefined {
  const $ = typeof htmlOrCheerio === 'string' ? loadHtml(htmlOrCheerio) : htmlOrCheerio;

  const candidates: string[] = [];
  const pickMeta = (sel: string) => {
    const v = $(sel).attr('content')?.trim();
    if (v) candidates.push(v);
  };
  pickMeta('meta[property="article:published_time"]');
  pickMeta('meta[property="og:article:published_time"]');
  pickMeta('meta[name="datePublished"]');
  pickMeta('meta[itemprop="datePublished"]');

  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).text();
    try {
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const v = item?.datePublished ?? item?.dateCreated;
        if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
      }
    } catch {
      // not JSON; skip
    }
  });

  const t = $('time[datetime]').first().attr('datetime')?.trim();
  if (t) candidates.push(t);

  for (const raw of candidates) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}
```

> Note: `cheerio` is already imported at the top of `scrape.ts`. Your existing
> `loadHtml`/`load` import name might differ — match what's already in the file
> (don't duplicate-import). If the file uses `import { load as loadHtml } from 'cheerio'`,
> reuse that and drop the duplicate import in the snippet above.

- [ ] **Step 4: Wire into `extractArticle`**

Find `extractArticle(html, url)` in the same file and have its return object include `publishedAt: extractArticlePublishedAt($)` (pass the existing cheerio `$` instance — no double-parse). Add `publishedAt?: string` to the exported `ScrapeResult` type. Quote-anchor (read the file first to match indentation/style):

```ts
// In the existing return object of extractArticle:
return {
  title: metaTitle,
  description,
  image: rawImage,
  author: metaAuthor,
  text: cleanedText,
  kind,
  truncated,
  extractionWarnings,
  publishedAt: extractArticlePublishedAt($),
};
```

```ts
// In ScrapeResult:
export type ScrapeResult = {
  title: string;
  description: string;
  image: string;
  author: string;
  text: string;
  kind: ScrapeKind;
  truncated: boolean;
  extractionWarnings: string[];
  publishedAt?: string;
};
```

- [ ] **Step 5: Tests pass; lint clean.** Run `npm run test && npm run lint`. Expected: 5 new tests + existing pass; lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scrape.ts src/lib/scrape.test.ts
git commit -m "feat(scrape): extract article published date (og/json-ld/<time>) with tests"
```

---

## Task 3: PDF-date parser — TDD

**Files:** Create `src/lib/pdf-date.ts`; create `src/lib/pdf-date.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { parsePdfDate } from './pdf-date';

describe('parsePdfDate', () => {
  it('parses a full UTC PDF date', () => {
    expect(parsePdfDate('D:20230615123456Z')).toBe('2023-06-15T12:34:56.000Z');
  });
  it('parses a tz-offset PDF date', () => {
    // +05'00' means the local time is 5h ahead of UTC, so UTC is 5h earlier.
    expect(parsePdfDate("D:20230615123456+05'00'")).toBe('2023-06-15T07:34:56.000Z');
  });
  it('parses a date-only PDF date (no time)', () => {
    expect(parsePdfDate('D:20230615')).toBe('2023-06-15T00:00:00.000Z');
  });
  it('parses a year-only PDF date', () => {
    expect(parsePdfDate('D:2023')).toBe('2023-01-01T00:00:00.000Z');
  });
  it('returns null for malformed input', () => {
    expect(parsePdfDate('not a pdf date')).toBeNull();
    expect(parsePdfDate('D:abcd')).toBeNull();
    expect(parsePdfDate('')).toBeNull();
  });
  it('returns null for non-string input', () => {
    expect(parsePdfDate(undefined as unknown as string)).toBeNull();
    expect(parsePdfDate(null as unknown as string)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — FAIL** (`parsePdfDate` not defined).

- [ ] **Step 3: Implement**

Create `src/lib/pdf-date.ts`:

```ts
/**
 * Parse a PDF metadata date string into an ISO UTC string.
 * PDF spec format: `D:YYYYMMDDHHmmss[OHH'mm']` where O is `+`, `-`, or `Z`.
 * Components after the year are optional and default to 0 (month/day default to 01).
 * Returns null on malformed input.
 */
export function parsePdfDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('D:')) return null;
  const m = raw.match(
    /^D:(\d{4})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2}))?)?)?)?)?(Z|[+-]\d{2}'\d{2}')?$/,
  );
  if (!m) return null;
  const [, Y, Mo = '01', D = '01', H = '00', Mi = '00', S = '00', tz] = m;
  let isoTz = 'Z';
  if (tz && tz !== 'Z') {
    isoTz = `${tz[0]}${tz.slice(1, 3)}:${tz.slice(4, 6)}`;
  }
  const iso = `${Y}-${Mo}-${D}T${H}:${Mi}:${S}${isoTz}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
```

- [ ] **Step 4: Tests pass; lint clean.** Run `npm run test && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf-date.ts src/lib/pdf-date.test.ts
git commit -m "feat(pdf): parsePdfDate — PDF metadata date string → ISO with tests"
```

---

## Task 4: Plumb `publishedAt` end-to-end through `captureSignal` + reprocess + GET

**Files:** Modify `src/lib/capture.ts`, `src/lib/reprocess.ts`, `src/app/api/nodes/route.ts`, `src/app/api/capture/from-storage/route.ts`.

- [ ] **Step 1: Add `publishedAt` to `Prefetched`** (`src/lib/capture.ts`)

Find the `Prefetched` type and add `publishedAt?: string;`:

```ts
type Prefetched = {
  kind: string;
  title?: string;
  text?: string;
  image?: string;
  description?: string;
  author?: string;
  publishedAt?: string;
};
```

- [ ] **Step 2: Carry `publishedAt` through `captureSignal`'s `scrape` build and insert**

In the `prefetched` branch where the in-memory `scrape` object is constructed, add `publishedAt: prefetched.publishedAt ?? undefined,`. Then in the `nodes.insert({...})` call, add `published_at: scrape.publishedAt ?? null,`. The full insert object now reads:

```ts
const { data: node, error: nodeError } = await getSupabaseAdmin()
  .from('nodes')
  .insert({
    workspace_id: workspaceId,
    created_by: userId,
    original_url: url,
    raw_text: capturedText || normalizedRawText || scrape.text,
    content_type: url ? 'link' : 'text',
    scrape_kind: scrape.kind,
    title: scrape.title,
    og_image_url: scrape.image,
    source_description: scrape.description,
    source_author: scrape.author,
    user_notes: userNote || null,
    published_at: scrape.publishedAt ?? null,
  })
  .select('id, title, original_url, raw_text, source_description, source_author, user_notes')
  .single();
```

(`scrape.publishedAt` is now available because `extractArticle` returns it (Task 2) and the prefetched branch was updated above. The implicit type on the inline `scrape` object will infer `publishedAt: string | undefined`.)

- [ ] **Step 3: Write the reprocess update** (`src/lib/reprocess.ts`)

Find the link-reprocess `update` object built from the re-scraped result, and add `published_at: scrape.publishedAt ?? null,` to it. (PDFs aren't covered here — they don't re-fetch the file; the spec says PDF backfill goes through manual edit.)

- [ ] **Step 4: Expose `published_at` from `/api/nodes`** (`src/app/api/nodes/route.ts`)

(a) Add `published_at` to the SELECT string (insert it right after `created_at`):

```ts
const select =
  'id,workspace_id,title,original_url,og_image_url,source_description,source_author,raw_text,user_notes,ai_summary,scrape_kind,media_path,created_by,created_at,published_at,users(display_name,email),node_tags(tags(shift_name))';
```

(b) Add `published_at: string | null;` to the `NodeListRow` type.
(c) Add `published_at: node.published_at,` to the mapping that builds the response.

- [ ] **Step 5: Pass PDF `publishedAt` from `from-storage`** (`src/app/api/capture/from-storage/route.ts`)

In the PDF branch, between the `getDocumentProxy(buf)` line and `extractText(...)`, read the metadata and pass it into `captureSignal`'s `prefetched`. Existing code:

```ts
const { extractText, getDocumentProxy } = await import('unpdf');
const pdf = await getDocumentProxy(new Uint8Array(buf));
const r = await extractText(pdf, { mergePages: true });
```

Add metadata read just after `getDocumentProxy` (don't break the existing `try/catch`; if metadata is missing or throws, leave `publishedAt` undefined):

```ts
const { extractText, getDocumentProxy } = await import('unpdf');
const pdf = await getDocumentProxy(new Uint8Array(buf));
let pdfPublishedAt: string | undefined;
try {
  const meta = await pdf.getMetadata();
  const info = (meta as { info?: { CreationDate?: unknown } } | null)?.info;
  const raw = info?.CreationDate;
  if (raw) {
    const { parsePdfDate } = await import('@/lib/pdf-date');
    pdfPublishedAt = parsePdfDate(raw) ?? undefined;
  }
} catch {
  // metadata unavailable; leave publishedAt unset
}
const r = await extractText(pdf, { mergePages: true });
```

Then pass it into `captureSignal`'s `prefetched`:

```ts
const result = await captureSignal({
  userId,
  workspaceId,
  prefetched: {
    kind: 'pdf',
    title: fileName.replace(/\.pdf$/i, ''),
    text,
    publishedAt: pdfPublishedAt,
  },
});
```

- [ ] **Step 6: Build + lint + tests clean**

`npm run lint && npm run test && npm run build` → all green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/capture.ts src/lib/reprocess.ts src/app/api/nodes/route.ts src/app/api/capture/from-storage/route.ts
git commit -m "feat(dates): plumb publishedAt through captureSignal, reprocess, and /api/nodes"
```

---

## Task 5: `PATCH /api/nodes/[nodeId]` for manual edit

**Files:** Modify `src/app/api/nodes/[nodeId]/route.ts`.

- [ ] **Step 1: Add a PATCH handler**

Read the existing file (it has GET only). Add the import for `getSupabaseAdmin` if missing (the GET likely uses it already). Append this handler:

```ts
export async function PATCH(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const body = await req.json();
    const { workspaceId, publishedAt } = body ?? {};
    if (!workspaceId || !nodeId) {
      return Response.json({ error: 'workspaceId and nodeId required' }, { status: 400 });
    }
    await assertWorkspaceMember(workspaceId, userId);

    const updates: Record<string, unknown> = {};
    if (publishedAt === null) updates.published_at = null;
    else if (typeof publishedAt === 'string' && publishedAt.trim()) {
      const d = new Date(publishedAt);
      if (Number.isNaN(d.getTime())) {
        return Response.json({ error: 'publishedAt must be a valid ISO date or null' }, { status: 400 });
      }
      updates.published_at = d.toISOString();
    }

    if (!Object.keys(updates).length) return Response.json({ ok: true, unchanged: true });

    const { data, error } = await getSupabaseAdmin()
      .from('nodes')
      .update(updates)
      .eq('id', nodeId)
      .eq('workspace_id', workspaceId)
      .select('id,published_at')
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, node: data });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
```

- [ ] **Step 2: Lint + build**

`npm run lint && npm run build` → clean; `/api/nodes/[nodeId]` shows up as dynamic (it already did for GET; PATCH joins the same route).

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/nodes/[nodeId]/route.ts"
git commit -m "feat(api): PATCH /api/nodes/[nodeId] for manual published_at edit"
```

---

## Task 6: Drawer — dual date display + datetime-local editor

**Files:** Modify `src/app/minds/[id]/page.tsx`.

- [ ] **Step 1: Add `published_at` to the local `CaptureItem` type**

Find the `type CaptureItem = { … }` block and add:

```ts
  published_at?: string | null;
```

- [ ] **Step 2: Add a small ISO formatter for absolute years**

Near the existing `relativeTimeFrom`, add a helper that renders an ISO as an absolute "month yyyy":

```tsx
function absoluteDate(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}
```

- [ ] **Step 3: Add the dual line in the drawer body**

In the drawer body (inside `capture-drawer__body`), after the existing `<h2>{selectedCapture.title ?? 'Untitled capture'}</h2>` and before the TLDR/notes blocks, render:

```tsx
<p className="meta">
  {selectedCapture.published_at ? `Published ${absoluteDate(selectedCapture.published_at)} · ` : ''}
  Shared {relativeTimeFrom(selectedCapture.created_at)}
</p>
```

- [ ] **Step 4: Add the editable input + save**

Add state at the top of the component:

```tsx
const [publishedAtDraft, setPublishedAtDraft] = useState('');
const [publishedAtBusy, setPublishedAtBusy] = useState(false);
```

When `selectedCapture` changes, seed the draft (place this with the other `useEffect` for the selected capture; new effect is fine):

```tsx
useEffect(() => {
  setPublishedAtDraft(
    selectedCapture?.published_at
      ? new Date(selectedCapture.published_at).toISOString().slice(0, 16)
      : '',
  );
}, [selectedCapture?.id, selectedCapture?.published_at]);
```

Add the save handler:

```tsx
const savePublishedAt = async () => {
  if (!selectedCapture || !workspaceId) return;
  setPublishedAtBusy(true);
  const value = publishedAtDraft
    ? new Date(publishedAtDraft).toISOString()
    : null;
  const r = await authedFetch(`/api/nodes/${selectedCapture.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ workspaceId, publishedAt: value }),
  });
  setPublishedAtBusy(false);
  if (r.ok) {
    updateCapture(selectedCapture.id, { published_at: value });
    setStatus(value ? 'Published date saved.' : 'Published date cleared.');
  } else {
    const d = await r.json();
    setStatus(d.error ?? 'Could not save published date.');
  }
};
```

(`updateCapture` already exists in this component; it patches both `recentCaptures` and `selectedCapture`.)

Render the editor in the drawer body, near other meta fields:

```tsx
<div className="ms-field">
  <span className="ms-field__label">
    Published date <span className="ms-field__optional">— optional, original date of the source</span>
  </span>
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <input
      type="datetime-local"
      className="ms-input"
      value={publishedAtDraft}
      onChange={(e) => setPublishedAtDraft(e.target.value)}
    />
    <button
      type="button"
      className="ms-btn"
      onClick={savePublishedAt}
      disabled={publishedAtBusy}
    >
      {publishedAtBusy ? 'Saving…' : 'Save'}
    </button>
  </div>
</div>
```

- [ ] **Step 5: Lint + build**

`npm run lint && npm run build` → clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/minds/[id]/page.tsx"
git commit -m "feat(drawer): show Published / Shared dual dates + manual editor"
```

---

## Task 7: Full build + verification

- [ ] **Step 1: Full build, lint, tests**

`npm run lint`, `npm run test` (≥ 10 + new article/pdf tests pass), `npm run build` — all green.

- [ ] **Step 2: Browser checks** (`npm run dev`)

1. Capture a fresh link with `<meta property="article:published_time" content="…">` — open its drawer. **Published <date> · Shared just now** appears.
2. Capture a fresh PDF whose metadata has `CreationDate`. Open the drawer; **Published** is set.
3. On an older link capture (pre-existing), open the drawer and run **Reprocess** — `published_at` is filled in if the article exposes one.
4. On a capture with no extracted date, type a date in the datetime-local input and click **Save** — meta refreshes to *Published <date>* immediately and the value persists on reload.
5. Clear the datetime-local input and Save — the Published line disappears.
6. Verify Mind permission: an unrelated user can't PATCH this node (the route returns 401/forbidden).

- [ ] **Step 3: Commit any final tweaks** (none expected; CSS for `.ms-field` already exists.)

---

## Self-review notes
- **Spec coverage:**
  - Article meta + JSON-LD + `<time>` extraction → Task 2.
  - PDF metadata `CreationDate` extraction → Task 3 (parser) + Task 4 step 5 (call site).
  - Manual edit (drawer) → Task 6.
  - Reprocess backfill (links) → Task 4 step 3. PDFs backfill via manual edit only (per spec).
  - Dual display on the drawer ("Published … · Shared …") → Task 6 step 3.
  - Defer EXIF / mass-reprocess → not in this plan (per spec out-of-scope).
- **Pure logic gets tests; routes/UI use build + browser** — matches repo norm.
- **Type consistency:** `publishedAt` (camel, in TS types and JSON bodies) ↔ `published_at` (snake, in DB + Supabase rows + on the local `CaptureItem`/`NodeListRow`). The PATCH route accepts `publishedAt` from the client; the column is `published_at`.
```
