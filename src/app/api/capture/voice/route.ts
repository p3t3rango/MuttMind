import { requireUserId } from '@/lib/auth';
import { captureSignal } from '@/lib/capture';
import { env } from '@/lib/env';
import { transcribeAudio } from '@/lib/llm';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20MB

/**
 * POST /api/capture/voice  (multipart: audio, workspaceId)
 * Record → Gemini transcription → normal text capture. The audio itself is
 * NOT persisted (transcript-only); no storage bucket needed. Gated behind
 * MUTTMIND_VOICE_ENABLED (LLM cost).
 */
export async function POST(req: Request) {
  if (!env.voiceEnabled) {
    return Response.json(
      { error: 'Voice capture is not enabled on this server.', hint: 'Set MUTTMIND_VOICE_ENABLED=1.' },
      { status: 503 },
    );
  }
  try {
    const userId = await requireUserId(req);
    const form = await req.formData();
    const workspaceId = String(form.get('workspaceId') ?? '');
    const file = form.get('audio');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (!(file instanceof Blob)) return Response.json({ error: 'audio required' }, { status: 400 });
    if (file.size > MAX_AUDIO_BYTES) {
      return Response.json({ error: 'Recording too large (20MB max).' }, { status: 413 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const base64 = buf.toString('base64');
    const mimeType = file.type || 'audio/webm';

    const transcript = (await transcribeAudio({ base64, mimeType })).trim();
    if (!transcript) {
      return Response.json({ error: 'Could not transcribe — nothing audible.' }, { status: 422 });
    }

    // Persist the audio (private bucket) so the memo stays listenable.
    const ext = (mimeType.split('/')[1] || 'webm').split(';')[0];
    const path = `${workspaceId}/voice-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await getSupabaseAdmin()
      .storage.from('captures')
      .upload(path, buf, { contentType: mimeType, upsert: false });
    if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

    const stamp = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const result = await captureSignal({
      userId,
      workspaceId,
      prefetched: {
        kind: 'audio',
        title: `Voice memo · ${stamp}`,
        text: transcript,
      },
    });
    const { error: setErr } = await getSupabaseAdmin()
      .from('nodes')
      .update({ media_path: path })
      .eq('id', result.nodeId);
    if (setErr) return Response.json({ error: setErr.message }, { status: 500 });

    return Response.json({ ok: true, nodeId: result.nodeId, transcript });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
