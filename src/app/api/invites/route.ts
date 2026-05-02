import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceAdmin } from '@/lib/workspace';

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const workspaceId = new URL(req.url).searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });

    await assertWorkspaceAdmin(workspaceId, userId);
    const { data, error } = await getSupabaseAdmin()
      .from('workspace_invites')
      .select('id,email,token,role,accepted_at,expires_at,created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ invites: data ?? [] });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, email, role = 'member' } = await req.json();
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (!['admin', 'member'].includes(role)) return Response.json({ error: 'Invalid role' }, { status: 400 });

    await assertWorkspaceAdmin(workspaceId, userId);
    const { data, error } = await getSupabaseAdmin()
      .from('workspace_invites')
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        email: typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null,
        role,
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
      })
      .select('id,email,token,role,accepted_at,expires_at,created_at')
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ invite: data });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
