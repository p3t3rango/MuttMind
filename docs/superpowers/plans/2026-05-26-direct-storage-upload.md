# Direct-to-Storage Uploads (large PDFs/images) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload large files (e.g. a 33.5 MB PDF) by uploading the browser → Supabase Storage directly via a signed URL, then processing server-side from storage — bypassing Vercel's ~4.5 MB serverless request-body limit.

**Architecture:** Two new routes — `POST /api/capture/upload-url` mints a short-lived Supabase signed upload URL for the private `captures` bucket (auth + workspace-member gated); the browser uploads the file straight to storage with `uploadToSignedUrl`; then `POST /api/capture/from-storage` (server, service-role) downloads the object, extracts PDF text via `unpdf` (or sets `media_path` for images), runs `captureSignal`, and for PDFs deletes the temp object. The client's `onPickFile` is reworked to this flow. The old multipart `/api/capture/upload` stays but is no longer used by the UI.

**Tech Stack:** Next.js route handlers (`nodejs` runtime, `maxDuration` 300), Supabase Storage (`createSignedUploadUrl` / `uploadToSignedUrl` / `download` / `remove`), `unpdf`, existing `captureSignal`.

**Context:** Root cause — Vercel serverless functions cap request bodies at ~4.5 MB; the current `/api/capture/upload` receives the file as multipart through the function, so anything larger is rejected by the platform before our code runs. The route's `MAX_BYTES = 25 MB` is therefore unreachable on Vercel. Direct-to-storage is the standard fix.

**Decision flagged (confirm during review):** After extracting a PDF's text we **delete** the uploaded object (matches today's "PDFs are not persisted" behavior; keeps storage lean). Images keep their object (`media_path`, as today). If you'd rather *keep* the original PDF for re-download, that's a small change + a drawer affordance — say so.

---

## File map
- **Create** `src/app/api/capture/upload-url/route.ts` — mint a signed upload URL (auth + member check).
- **Create** `src/app/api/capture/from-storage/route.ts` — process an already-uploaded object (download → pdf/image → captureSignal).
- **Modify** `src/app/minds/[id]/page.tsx` — rework `onPickFile` to the signed-URL flow + a client size guard.
- **Migration** `supabase/captures_bucket_size_patch.sql` — raise the `captures` bucket file-size limit to ≥ 50 MB (applied to the DB).

Verification: build + lint + browser (storage integration; no new pure logic worth unit-testing). The decisive win is verified on the deployed site (the body-limit only bites on Vercel), but the flow is fully testable locally too.

---

## Task 1: Raise the `captures` bucket file-size limit

**Files:** Create `supabase/captures_bucket_size_patch.sql`.

- [ ] **Step 1: Write the migration** — Supabase per-bucket limit can be below the file size; set it to 50 MB so a 33.5 MB PDF is accepted:

```sql
-- Allow larger direct-to-storage uploads (the 'captures' bucket may default
-- below the file size of large PDFs). 50 MB ceiling.
update storage.buckets
set file_size_limit = 52428800
where id = 'captures';
```

- [ ] **Step 2: Apply to the dev DB and confirm.** Run the SQL against the linked DB (controller applies via psql, or tell the user to run it in the Supabase SQL editor).
Expected: `select id, file_size_limit from storage.buckets where id='captures';` → `52428800`. (If the row doesn't exist, the `captures` bucket must be created first — report that.)

- [ ] **Step 3: Commit:**
```bash
git add supabase/captures_bucket_size_patch.sql
git commit -m "feat(upload): raise captures bucket file-size limit to 50MB"
```

---

## Task 2: `POST /api/capture/upload-url` — mint signed upload URL

**Files:** Create `src/app/api/capture/upload-url/route.ts`.

- [ ] **Step 1: Write the route:**

```ts
import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

export const runtime = 'nodejs';

/**
 * POST /api/capture/upload-url  { workspaceId, filename }
 * Mints a short-lived signed upload URL into the private `captures` bucket so
 * the browser can upload large files directly (bypassing the serverless body
 * limit). Returns { path, token } for uploadToSignedUrl. Member-gated.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, filename } = await req.json();
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const ext = (String(filename ?? '').match(/\.([a-z0-9]+)$/i)?.[1] || 'bin').toLowerCase();
    const path = `${workspaceId}/${crypto.randomUUID()}.${ext}`;

    const { data, error } = await getSupabaseAdmin()
      .storage.from('captures')
      .createSignedUploadUrl(path);
    if (error || !data) {
      return Response.json({ error: error?.message ?? 'Could not create upload URL' }, { status: 500 });
    }
    return Response.json({ path: data.path, token: data.token });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
```

- [ ] **Step 2:** `npm run lint && npm run build` → clean; `/api/capture/upload-url` present.
- [ ] **Step 3: Commit:**
```bash
git add src/app/api/capture/upload-url/route.ts
git commit -m "feat(upload): /api/capture/upload-url mints a signed upload URL"
```

---

## Task 3: `POST /api/capture/from-storage` — process the uploaded object

**Files:** Create `src/app/api/capture/from-storage/route.ts`.

- [ ] **Step 1: Write the route** (mirrors the PDF/image logic from `src/app/api/capture/upload/route.ts`, but reads the bytes from storage instead of the request body):

```ts
import { requireUserId } from '@/lib/auth';
import { captureSignal } from '@/lib/capture';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/capture/from-storage  { workspaceId, path, name }
 * Processes a file the browser already uploaded to the `captures` bucket via a
 * signed URL. PDF: text extracted server-side (unpdf), then the temp object is
 * deleted (PDFs are not persisted). Image: keep the object, store media_path.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, path, name } = await req.json();
    if (!workspaceId || typeof path !== 'string' || !path) {
      return Response.json({ error: 'workspaceId and path required' }, { status: 400 });
    }
    await assertWorkspaceMember(workspaceId, userId);

    // Guard: the path must live under this workspace's prefix (the signed URL
    // we minted always does — this blocks a forged path into another Mind).
    if (!path.startsWith(`${workspaceId}/`)) {
      return Response.json({ error: 'path does not belong to this Mind' }, { status: 403 });
    }

    const fileName = String(name ?? path.split('/').pop() ?? 'upload');
    const isPdf = /\.pdf$/i.test(fileName) || /\.pdf$/i.test(path);
    const isImage = /\.(png|jpe?g|gif|webp|avif)$/i.test(fileName) || /\.(png|jpe?g|gif|webp|avif)$/i.test(path);
    const db = getSupabaseAdmin();

    if (isPdf) {
      const { data: blob, error: dlErr } = await db.storage.from('captures').download(path);
      if (dlErr || !blob) return Response.json({ error: dlErr?.message ?? 'download failed' }, { status: 500 });
      const buf = Buffer.from(await blob.arrayBuffer());

      let text = '';
      try {
        const { extractText, getDocumentProxy } = await import('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(buf));
        const r = await extractText(pdf, { mergePages: true });
        text = (Array.isArray(r.text) ? r.text.join('\n\n') : r.text)
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      } catch (e) {
        await db.storage.from('captures').remove([path]);
        return Response.json({ error: `Could not read PDF: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 422 });
      }
      if (!text) {
        await db.storage.from('captures').remove([path]);
        return Response.json({ error: 'No extractable text in that PDF.' }, { status: 422 });
      }

      const result = await captureSignal({
        userId,
        workspaceId,
        prefetched: { kind: 'pdf', title: fileName.replace(/\.pdf$/i, ''), text },
      });
      await db.storage.from('captures').remove([path]); // PDFs not persisted
      return Response.json({ ok: true, nodeId: result.nodeId, kind: 'pdf' });
    }

    if (isImage) {
      const result = await captureSignal({
        userId,
        workspaceId,
        prefetched: { kind: 'image', title: fileName },
      });
      const { error: setErr } = await db.from('nodes').update({ media_path: path }).eq('id', result.nodeId);
      if (setErr) return Response.json({ error: setErr.message }, { status: 500 });
      return Response.json({ ok: true, nodeId: result.nodeId, kind: 'image' });
    }

    await db.storage.from('captures').remove([path]);
    return Response.json({ error: 'Only PDF and image files are supported.' }, { status: 415 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
```

- [ ] **Step 2:** `npm run lint && npm run build` → clean; `/api/capture/from-storage` present.
- [ ] **Step 3: Commit:**
```bash
git add src/app/api/capture/from-storage/route.ts
git commit -m "feat(upload): /api/capture/from-storage processes uploaded objects (pdf/image)"
```

---

## Task 4: Client — rework `onPickFile` to the direct-upload flow

**Files:** Modify `src/app/minds/[id]/page.tsx`.

- [ ] **Step 1: Read the current `onPickFile`** (it builds a FormData and POSTs to `/api/capture/upload`). Replace its body with the signed-URL flow. It uses existing helpers `authedFetch` and `getSupabaseBrowser` (import `getSupabaseBrowser` from `@/lib/client-auth` if not already imported in this file — check the import line; `getAccessToken`/`getSupabaseBrowser` come from there). New `onPickFile`:

```tsx
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!workspaceId) {
      setStatus('Create or choose a Mind first.');
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setStatus('File too large (50MB max).');
      return;
    }
    setUploadBusy(true);
    setStatus(`Uploading ${f.name}…`);
    try {
      // 1. Mint a signed upload URL (small JSON request — never the file).
      const urlRes = await authedFetch('/api/capture/upload-url', {
        method: 'POST',
        body: JSON.stringify({ workspaceId, filename: f.name }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok || !urlData.path || !urlData.token) {
        setStatus(urlData.error ?? 'Upload failed.');
        return;
      }
      // 2. Upload the file straight to Supabase Storage (no serverless body limit).
      const { error: upErr } = await getSupabaseBrowser()
        .storage.from('captures')
        .uploadToSignedUrl(urlData.path, urlData.token, f, { contentType: f.type || undefined });
      if (upErr) {
        setStatus(`Upload failed: ${upErr.message}`);
        return;
      }
      // 3. Process server-side from storage.
      const procRes = await authedFetch('/api/capture/from-storage', {
        method: 'POST',
        body: JSON.stringify({ workspaceId, path: urlData.path, name: f.name }),
      });
      const procData = await procRes.json();
      if (!procRes.ok) {
        setStatus(procData.error ?? 'Upload failed.');
        return;
      }
      setStatus(procData.kind === 'pdf' ? 'PDF captured.' : 'Image captured.');
      loadRecentCaptures();
    } catch {
      setStatus('Upload failed.');
    } finally {
      setUploadBusy(false);
    }
  };
```

> Confirm `getSupabaseBrowser` is imported in this file (the dashboard/Board uses it elsewhere — it's from `@/lib/client-auth`). If missing, add it to the existing `client-auth` import.

- [ ] **Step 2:** `npm run lint && npm run build` → clean.
- [ ] **Step 3: Commit:**
```bash
git add "src/app/minds/[id]/page.tsx"
git commit -m "feat(upload): Board uploads files direct-to-storage (handles large PDFs)"
```

---

## Task 5: Build + verification

- [ ] **Step 1: Full build + lint + tests:** `npm run build` (succeeds; routes `/api/capture/upload-url` and `/api/capture/from-storage` present), `npm run lint` (clean), `npm run test` (existing suites still pass).

- [ ] **Step 2: Local browser check** (`npm run dev`): on a Mind's Board, click the attach (paperclip) and pick a small PDF and an image → both capture (network tab shows: POST `/api/capture/upload-url`, a PUT to the Supabase storage signed URL, then POST `/api/capture/from-storage`). The capture appears on the board.

- [ ] **Step 3: The real test (deployed):** after merge + deploy, upload the 33.5 MB PDF on the live site → it should now succeed (the bytes go to storage, not through the function). Confirm a single capture with the PDF's text, and that the temp PDF object was removed from the `captures` bucket.

- [ ] **Step 4:** No new styles needed (reuses the existing attach control + status line).

---

## Self-review notes
- **Root cause addressed:** the file no longer transits the serverless function (only small JSON does), so the ~4.5 MB Vercel body limit no longer applies; Supabase bucket limit raised to 50 MB (Task 1).
- **Security:** `upload-url` is member-gated and only ever mints paths under `${workspaceId}/`; `from-storage` re-checks membership AND verifies `path.startsWith(workspaceId + '/')` so a forged path can't write into / capture from another Mind.
- **Behavior parity:** PDF text-extract + non-persistence preserved (object deleted after extract / on failure); images keep `media_path` exactly as before; `captureSignal` prefetched shapes unchanged.
- **Deferred / flagged:** keeping the original PDF for re-download (would set `media_path` + add a drawer "open PDF" link) — confirm during review. The old `/api/capture/upload` route is left in place (unused by the UI) — can be retired in a follow-up.
```
