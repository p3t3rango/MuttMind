import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

async function assertNodeInWorkspace(nodeId: string, workspaceId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('nodes')
    .select('id')
    .eq('id', nodeId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Capture not found in this Mind.');
}

export async function GET(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const workspaceId = new URL(req.url).searchParams.get('workspaceId');

    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);
    await assertNodeInWorkspace(nodeId, workspaceId);

    const { data, error } = await getSupabaseAdmin()
      .from('node_notes')
      .select('id,body,created_at,created_by,users(display_name,email)')
      .eq('node_id', nodeId)
      .order('created_at', { ascending: false });

    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ notes: data ?? [] });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function POST(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const { workspaceId, body } = await req.json();
    const noteBody = String(body ?? '').trim();

    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (!noteBody) return Response.json({ error: 'note body required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);
    await assertNodeInWorkspace(nodeId, workspaceId);

    const { data, error } = await getSupabaseAdmin()
      .from('node_notes')
      .insert({ node_id: nodeId, created_by: userId, body: noteBody })
      .select('id,body,created_at,created_by,users(display_name,email)')
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ note: data });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    const noteId = url.searchParams.get('noteId');

    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (!noteId) return Response.json({ error: 'noteId required' }, { status: 400 });
    const role = await assertWorkspaceMember(workspaceId, userId);
    await assertNodeInWorkspace(nodeId, workspaceId);

    const { data: note, error: noteError } = await getSupabaseAdmin()
      .from('node_notes')
      .select('created_by')
      .eq('id', noteId)
      .eq('node_id', nodeId)
      .maybeSingle();

    if (noteError) return Response.json({ error: noteError.message }, { status: 500 });
    if (!note) return Response.json({ ok: true });
    if (note.created_by !== userId && !['owner', 'admin'].includes(role)) {
      return Response.json({ error: 'Only note authors or Mind admins can delete notes.' }, { status: 403 });
    }

    const { error } = await getSupabaseAdmin().from('node_notes').delete().eq('id', noteId).eq('node_id', nodeId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
