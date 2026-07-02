import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceAdmin } from '@/lib/workspace';

/**
 * POST /api/tags/merge — fold duplicate tags into one canonical tag.
 * Body: { workspaceId, fromTagIds: string[], toTagId }
 * Every capture tagged with a source tag gets the target tag instead, then the
 * source tags are deleted (cascade clears their node_tags rows).
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, fromTagIds, toTagId } = await req.json();
    if (!workspaceId || !toTagId || !Array.isArray(fromTagIds)) {
      return Response.json({ error: 'workspaceId, fromTagIds and toTagId required' }, { status: 400 });
    }
    await assertWorkspaceAdmin(workspaceId, userId);

    const sourceIds: string[] = fromTagIds.filter((id) => typeof id === 'string' && id && id !== toTagId);
    if (!sourceIds.length) {
      return Response.json({ error: 'Nothing to merge — pick at least one other tag.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // All involved tags must belong to this workspace — a foreign id would let
    // an admin of Mind A rewrite tags in Mind B.
    const { data: tagRows, error: tagErr } = await supabase
      .from('tags')
      .select('id')
      .eq('workspace_id', workspaceId)
      .in('id', [...sourceIds, toTagId]);
    if (tagErr) return Response.json({ error: tagErr.message }, { status: 500 });
    const known = new Set((tagRows ?? []).map((t) => t.id));
    if (!known.has(toTagId) || sourceIds.some((id) => !known.has(id))) {
      return Response.json({ error: 'Tag not found in this Mind.' }, { status: 404 });
    }

    const { data: links, error: linkErr } = await supabase
      .from('node_tags')
      .select('node_id')
      .in('tag_id', sourceIds);
    if (linkErr) return Response.json({ error: linkErr.message }, { status: 500 });

    const nodeIds = Array.from(new Set((links ?? []).map((l) => l.node_id)));
    if (nodeIds.length) {
      const { error: upsertErr } = await supabase.from('node_tags').upsert(
        nodeIds.map((nodeId) => ({ node_id: nodeId, tag_id: toTagId })),
        { onConflict: 'node_id,tag_id' },
      );
      if (upsertErr) return Response.json({ error: upsertErr.message }, { status: 500 });
    }

    const { error: deleteErr } = await supabase
      .from('tags')
      .delete()
      .eq('workspace_id', workspaceId)
      .in('id', sourceIds);
    if (deleteErr) return Response.json({ error: deleteErr.message }, { status: 500 });

    return Response.json({ ok: true, merged: sourceIds.length, retagged: nodeIds.length });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
