import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { token } = await req.json();
    if (!token) return Response.json({ error: 'token required' }, { status: 400 });

    const { data: invite, error: inviteError } = await getSupabaseAdmin()
      .from('workspace_invites')
      .select('id,workspace_id,email,role,accepted_at,expires_at')
      .eq('token', String(token))
      .maybeSingle();

    if (inviteError) return Response.json({ error: inviteError.message }, { status: 500 });
    if (!invite) return Response.json({ error: 'Invite not found.' }, { status: 404 });
    if (invite.accepted_at) return Response.json({ error: 'Invite already accepted.' }, { status: 409 });
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
      return Response.json({ error: 'Invite expired.' }, { status: 410 });
    }

    if (invite.email) {
      const { data: profile } = await getSupabaseAdmin()
        .from('users')
        .select('email')
        .eq('id', userId)
        .maybeSingle();
      if (profile?.email?.toLowerCase() !== invite.email.toLowerCase()) {
        return Response.json({ error: 'This invite was sent to a different email.' }, { status: 403 });
      }
    }

    const { error: memberError } = await getSupabaseAdmin()
      .from('workspace_members')
      .upsert(
        { workspace_id: invite.workspace_id, user_id: userId, role: invite.role },
        { onConflict: 'workspace_id,user_id' },
      );

    if (memberError) return Response.json({ error: memberError.message }, { status: 500 });

    await getSupabaseAdmin()
      .from('workspace_invites')
      .update({ accepted_by: userId, accepted_at: new Date().toISOString() })
      .eq('id', invite.id);

    return Response.json({ ok: true, workspaceId: invite.workspace_id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
