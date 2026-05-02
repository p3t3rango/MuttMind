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
      .from('tags')
      .select('id,shift_name,description,created_at')
      .eq('workspace_id', workspaceId)
      .order('shift_name');
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ tags: data });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, shiftName, description } = await req.json();
    if (!workspaceId || !shiftName) return Response.json({ error: 'workspaceId and shiftName required' }, { status: 400 });
    await assertWorkspaceAdmin(workspaceId, userId);
    const normalized = String(shiftName).trim().toLowerCase();
    const { data, error } = await getSupabaseAdmin()
      .from('tags')
      .upsert(
        { workspace_id: workspaceId, shift_name: normalized, description: description?.trim() || null },
        { onConflict: 'workspace_id,shift_name' },
      )
      .select('id,shift_name,description,created_at')
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ tag: data });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, tagId, shiftName, description } = await req.json();
    if (!workspaceId || !tagId) return Response.json({ error: 'workspaceId and tagId required' }, { status: 400 });
    await assertWorkspaceAdmin(workspaceId, userId);
    const updates: Record<string, string | null> = {};
    if (typeof shiftName === 'string') updates.shift_name = shiftName.trim().toLowerCase();
    if (typeof description === 'string') updates.description = description.trim() || null;
    const { data, error } = await getSupabaseAdmin()
      .from('tags')
      .update(updates)
      .eq('id', tagId)
      .eq('workspace_id', workspaceId)
      .select('id,shift_name,description,created_at')
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ tag: data });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    const tagId = url.searchParams.get('tagId');
    if (!workspaceId || !tagId) return Response.json({ error: 'workspaceId and tagId required' }, { status: 400 });
    await assertWorkspaceAdmin(workspaceId, userId);
    const { error } = await getSupabaseAdmin().from('tags').delete().eq('id', tagId).eq('workspace_id', workspaceId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
