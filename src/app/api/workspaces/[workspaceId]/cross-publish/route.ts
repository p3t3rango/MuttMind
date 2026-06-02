import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    const userId = await requireUserId(req);
    // Membership confirms the Mind exists and the caller is in it (401 otherwise).
    // The owner gate is the created_by check below — admins of the Mind are NOT
    // entitled to flip this setting, only the original creator.
    await assertWorkspaceMember(workspaceId, userId);

    const admin = getSupabaseAdmin();
    const { data: ws } = await admin
      .from('workspaces').select('created_by').eq('id', workspaceId).maybeSingle();
    if (!ws) return Response.json({ error: 'Mind not found.' }, { status: 404 });
    if (ws.created_by !== userId) {
      return Response.json({ error: 'Mind-owner only.' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { allow?: unknown };
    if (typeof body.allow !== 'boolean') {
      return Response.json({ error: 'allow must be boolean' }, { status: 400 });
    }

    const { error } = await admin
      .from('workspaces')
      .update({ allow_member_cross_publish: body.allow })
      .eq('id', workspaceId);
    if (error) throw new Error(error.message);
    return Response.json({ ok: true, allowMemberCrossPublish: body.allow });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized';
    return Response.json({ error: msg }, { status: 401 });
  }
}
