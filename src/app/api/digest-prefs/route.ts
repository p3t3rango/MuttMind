import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

/**
 * GET /api/digest-prefs?workspaceId=X — the requesting user's opt-in state.
 */
export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const workspaceId = new URL(req.url).searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const { data } = await getSupabaseAdmin()
      .from('workspace_digest_prefs')
      .select('opt_in,last_sent_at')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    return Response.json({ optIn: Boolean(data?.opt_in), lastSentAt: data?.last_sent_at ?? null });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

/**
 * POST /api/digest-prefs  Body: { workspaceId, optIn }
 * Upserts the requesting user's digest opt-in for a Mind.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, optIn } = await req.json();
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const { error } = await getSupabaseAdmin()
      .from('workspace_digest_prefs')
      .upsert(
        { workspace_id: workspaceId, user_id: userId, opt_in: Boolean(optIn) },
        { onConflict: 'workspace_id,user_id' },
      );
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ ok: true, optIn: Boolean(optIn) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
