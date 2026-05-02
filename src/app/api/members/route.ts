import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceAdmin, assertWorkspaceMember } from '@/lib/workspace';

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const workspaceId = new URL(req.url).searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });

    await assertWorkspaceMember(workspaceId, userId);
    const { data, error } = await getSupabaseAdmin()
      .from('workspace_members')
      .select('role,created_at,users(id,email,display_name)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });

    if (error) return Response.json({ error: error.message }, { status: 500 });

    const members = (data ?? []).map((member: any) => ({
      role: member.role,
      createdAt: member.created_at,
      user: {
        id: member.users?.id,
        email: member.users?.email,
        displayName: member.users?.display_name,
      },
    }));

    return Response.json({ members });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, email, role = 'member' } = await req.json();
    if (!workspaceId || !email) return Response.json({ error: 'workspaceId and email required' }, { status: 400 });
    if (!['admin', 'member'].includes(role)) return Response.json({ error: 'Invalid role' }, { status: 400 });

    await assertWorkspaceAdmin(workspaceId, userId);
    const normalizedEmail = String(email).trim().toLowerCase();
    const { data: existingUser } = await getSupabaseAdmin()
      .from('users')
      .select('id,email,display_name')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingUser?.id) {
      const { error } = await getSupabaseAdmin()
        .from('workspace_members')
        .upsert(
          { workspace_id: workspaceId, user_id: existingUser.id, role },
          { onConflict: 'workspace_id,user_id' },
        );

      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ added: true, member: existingUser });
    }

    const { data: invite, error } = await getSupabaseAdmin()
      .from('workspace_invites')
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        email: normalizedEmail,
        role,
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
      })
      .select('id,token,email,role,created_at,expires_at')
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ added: false, invite });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
