import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

function normalizeTag(input: unknown) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

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

export async function POST(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const { workspaceId, tag } = await req.json();
    const shiftName = normalizeTag(tag);

    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (!shiftName) return Response.json({ error: 'tag required' }, { status: 400 });

    await assertWorkspaceMember(workspaceId, userId);
    await assertNodeInWorkspace(nodeId, workspaceId);

    const { data: tagRow, error: tagError } = await getSupabaseAdmin()
      .from('tags')
      .upsert(
        { workspace_id: workspaceId, shift_name: shiftName, description: null },
        { onConflict: 'workspace_id,shift_name' },
      )
      .select('id,shift_name')
      .single();

    if (tagError) return Response.json({ error: tagError.message }, { status: 500 });

    const { error: linkError } = await getSupabaseAdmin()
      .from('node_tags')
      .upsert({ node_id: nodeId, tag_id: tagRow.id }, { onConflict: 'node_id,tag_id' });

    if (linkError) return Response.json({ error: linkError.message }, { status: 500 });

    return Response.json({ tag: tagRow.shift_name });
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
    const shiftName = normalizeTag(url.searchParams.get('tag'));

    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (!shiftName) return Response.json({ error: 'tag required' }, { status: 400 });

    await assertWorkspaceMember(workspaceId, userId);
    await assertNodeInWorkspace(nodeId, workspaceId);

    const { data: tagRow, error: tagError } = await getSupabaseAdmin()
      .from('tags')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('shift_name', shiftName)
      .maybeSingle();

    if (tagError) return Response.json({ error: tagError.message }, { status: 500 });
    if (!tagRow) return Response.json({ ok: true });

    const { error } = await getSupabaseAdmin()
      .from('node_tags')
      .delete()
      .eq('node_id', nodeId)
      .eq('tag_id', tagRow.id);

    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
