import { requireUserId } from '@/lib/auth';
import { captureSignal } from '@/lib/capture';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

/**
 * POST /api/capture/upload  (multipart: file, workspaceId)
 *
 * PDF: text extracted server-side (unpdf), captured as text — the file
 * itself is not persisted (like voice). Image: uploaded to the PRIVATE
 * 'captures' bucket via service role; media_path stored on the node;
 * /api/nodes mints a short signed URL at list time (member-gated). No
 * public bucket, no new public route.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const form = await req.formData();
    const workspaceId = String(form.get('workspaceId') ?? '');
    const file = form.get('file');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (!(file instanceof Blob)) return Response.json({ error: 'file required' }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return Response.json({ error: 'File too large (25MB max).' }, { status: 413 });
    }
    await assertWorkspaceMember(workspaceId, userId);

    const name = (file instanceof File && file.name) || 'upload';
    const type = file.type || '';
    const buf = Buffer.from(await file.arrayBuffer());
    const isPdf = type.includes('pdf') || /\.pdf$/i.test(name);
    const isImage = type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(name);

    if (isPdf) {
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
        return Response.json(
          { error: `Could not read PDF: ${e instanceof Error ? e.message : 'unknown'}` },
          { status: 422 },
        );
      }
      if (!text) return Response.json({ error: 'No extractable text in that PDF.' }, { status: 422 });
      const result = await captureSignal({
        userId,
        workspaceId,
        prefetched: { kind: 'pdf', title: name.replace(/\.pdf$/i, ''), text },
      });
      return Response.json({ ok: true, nodeId: result.nodeId, kind: 'pdf' });
    }

    if (isImage) {
      const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || type.split('/')[1] || 'bin').toLowerCase();
      const path = `${workspaceId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await getSupabaseAdmin()
        .storage.from('captures')
        .upload(path, buf, { contentType: type || 'application/octet-stream', upsert: false });
      if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

      const result = await captureSignal({
        userId,
        workspaceId,
        prefetched: { kind: 'image', title: name },
      });
      const { error: setErr } = await getSupabaseAdmin()
        .from('nodes')
        .update({ media_path: path })
        .eq('id', result.nodeId);
      if (setErr) return Response.json({ error: setErr.message }, { status: 500 });
      return Response.json({ ok: true, nodeId: result.nodeId, kind: 'image' });
    }

    return Response.json({ error: 'Only PDF and image files are supported.' }, { status: 415 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
