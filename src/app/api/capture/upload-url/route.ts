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
