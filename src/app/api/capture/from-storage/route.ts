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

    // The path must live under this workspace's prefix (the signed URL we mint
    // always does — this blocks a forged path into another Mind).
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
      let pdfPublishedAt: string | undefined;
      try {
        const { extractText, getDocumentProxy } = await import('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(buf));
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
        prefetched: { kind: 'pdf', title: fileName.replace(/\.pdf$/i, ''), text, publishedAt: pdfPublishedAt },
      });
      const { error: setErr } = await db.from('nodes').update({ media_path: path }).eq('id', result.nodeId);
      if (setErr) return Response.json({ error: setErr.message }, { status: 500 });
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
