import { requireUserId } from '@/lib/auth';
import { userCan } from '@/lib/permissions';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceAdmin, assertWorkspaceMember } from '@/lib/workspace';

type MemberRow = {
  role: string;
  created_at: string;
  users?: {
    id?: string | null;
    email?: string | null;
    display_name?: string | null;
  } | null;
};

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

    const members = ((data ?? []) as unknown as MemberRow[]).map((member) => ({
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

/**
 * DELETE /api/members?workspaceId=X&userId=Y
 *
 * Remove a member from a Shared Mind. Two valid callers:
 *   - An owner/admin, or a member with `manage_members`, removing someone else.
 *   - Any member removing themselves (leaving the Mind).
 *
 * Guards:
 *   - Owners can never be removed via this endpoint (transfer ownership is a
 *     separate, future concern). An owner also can't "leave" — they'd orphan
 *     the Mind.
 *   - Removing a member also revokes their per-member permission grants and
 *     digest prefs for this Mind so nothing dangles.
 */
export async function DELETE(req: Request) {
  try {
    const requesterId = await requireUserId(req);
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    const targetUserId = url.searchParams.get('userId');
    if (!workspaceId || !targetUserId) {
      return Response.json({ error: 'workspaceId and userId required' }, { status: 400 });
    }

    const requesterRole = await assertWorkspaceMember(workspaceId, requesterId);
    const isSelf = targetUserId === requesterId;

    if (!isSelf) {
      const privileged =
        ['owner', 'admin'].includes(requesterRole) ||
        (await userCan(requesterId, workspaceId, 'manage_members'));
      if (!privileged) {
        return Response.json({ error: 'Not allowed to remove members from this Mind.' }, { status: 403 });
      }
    }

    // Look up the target's membership.
    const { data: targetRow, error: targetError } = await getSupabaseAdmin()
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', targetUserId)
      .maybeSingle();
    if (targetError) return Response.json({ error: targetError.message }, { status: 500 });
    if (!targetRow) return Response.json({ error: 'That person is not a member of this Mind.' }, { status: 404 });

    if (targetRow.role === 'owner') {
      return Response.json(
        { error: "The owner can't be removed. Transfer ownership first (not yet supported)." },
        { status: 400 },
      );
    }

    // Admins can't be removed by non-owners (only an owner can remove an admin).
    if (targetRow.role === 'admin' && requesterRole !== 'owner' && !isSelf) {
      return Response.json({ error: 'Only the owner can remove an admin.' }, { status: 403 });
    }

    const admin = getSupabaseAdmin();
    const { error: delError } = await admin
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', targetUserId);
    if (delError) return Response.json({ error: delError.message }, { status: 500 });

    // Clean up anything scoped to this member in this workspace.
    await admin
      .from('workspace_member_permissions')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', targetUserId);
    await admin
      .from('workspace_digest_prefs')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', targetUserId);

    return Response.json({ ok: true, left: isSelf });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
