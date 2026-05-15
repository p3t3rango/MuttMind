import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

type NodeRow = { id: string; workspace_id: string };

async function loadNodeHome(nodeId: string): Promise<NodeRow | null> {
  const { data } = await getSupabaseAdmin()
    .from('nodes')
    .select('id,workspace_id')
    .eq('id', nodeId)
    .maybeSingle();
  return (data as NodeRow | null) ?? null;
}

/**
 * GET /api/nodes/{nodeId}/connect?workspaceId=X
 * Returns the capture's home Mind + every Mind it's connected to, so the
 * picker can show current state. workspaceId is just for the access check
 * (caller must be a member of some Mind the capture is in).
 */
export async function GET(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const node = await loadNodeHome(nodeId);
    if (!node) return Response.json({ error: 'Capture not found' }, { status: 404 });

    const { data: connections } = await getSupabaseAdmin()
      .from('node_workspaces')
      .select('workspace_id')
      .eq('node_id', nodeId);

    const connectedIds = (connections ?? []).map((c) => (c as { workspace_id: string }).workspace_id);
    return Response.json({
      homeWorkspaceId: node.workspace_id,
      connectedWorkspaceIds: connectedIds,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

/**
 * POST /api/nodes/{nodeId}/connect  Body: { fromWorkspaceId, targetWorkspaceId }
 * Connect a capture to another Mind. Caller must be a member of BOTH the
 * capture's home Mind (or a Mind it's already in) and the target Mind.
 */
export async function POST(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const { fromWorkspaceId, targetWorkspaceId } = await req.json();
    if (!fromWorkspaceId || !targetWorkspaceId) {
      return Response.json({ error: 'fromWorkspaceId and targetWorkspaceId required' }, { status: 400 });
    }
    await assertWorkspaceMember(fromWorkspaceId, userId);
    await assertWorkspaceMember(targetWorkspaceId, userId);

    const node = await loadNodeHome(nodeId);
    if (!node) return Response.json({ error: 'Capture not found' }, { status: 404 });
    if (node.workspace_id === targetWorkspaceId) {
      return Response.json({ error: 'Capture already lives in this Mind.' }, { status: 400 });
    }

    const { error } = await getSupabaseAdmin()
      .from('node_workspaces')
      .upsert(
        { node_id: nodeId, workspace_id: targetWorkspaceId, added_by: userId },
        { onConflict: 'node_id,workspace_id' },
      );
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

/**
 * DELETE /api/nodes/{nodeId}/connect?workspaceId=X
 * Disconnect a capture from a non-home Mind. The home Mind connection can't
 * be removed this way (delete the capture itself for that).
 */
export async function DELETE(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const node = await loadNodeHome(nodeId);
    if (!node) return Response.json({ error: 'Capture not found' }, { status: 404 });
    if (node.workspace_id === workspaceId) {
      return Response.json(
        { error: "This is the capture's home Mind — delete the capture to remove it." },
        { status: 400 },
      );
    }

    const { error } = await getSupabaseAdmin()
      .from('node_workspaces')
      .delete()
      .eq('node_id', nodeId)
      .eq('workspace_id', workspaceId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
