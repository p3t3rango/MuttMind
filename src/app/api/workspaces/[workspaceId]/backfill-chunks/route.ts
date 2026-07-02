import { requireUserId } from '@/lib/auth';
import { reprocessNode } from '@/lib/reprocess';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/workspaces/[workspaceId]/backfill-chunks
 * Runs the full reprocess pipeline (re-scrape → summary → embed → chunks) over
 * every node in the workspace that has no node_chunks rows yet — the captures
 * made before MUTTMIND_CHUNKING_ENABLED was flipped. Sequential on purpose:
 * each reprocess already parallelizes its own embed calls, and this is a
 * one-off recovery path, not a hot endpoint.
 */
export async function POST(req: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId } = await context.params;
    await assertWorkspaceMember(workspaceId, userId);
    const supabase = getSupabaseAdmin();

    const { data: nodesData, error: nErr } = await supabase
      .from('nodes')
      .select('id')
      .eq('workspace_id', workspaceId);
    if (nErr) throw new Error(nErr.message);

    const { data: chunkedData, error: cErr } = await supabase
      .from('node_chunks')
      .select('node_id')
      .eq('workspace_id', workspaceId);
    if (cErr) throw new Error(cErr.message);
    const chunked = new Set((chunkedData ?? []).map((r) => r.node_id as string));

    const pending = (nodesData ?? []).map((n) => n.id as string).filter((id) => !chunked.has(id));

    const results: { nodeId: string; chunkCount?: number; error?: string }[] = [];
    for (const nodeId of pending) {
      try {
        const r = await reprocessNode(nodeId, workspaceId);
        results.push({ nodeId, chunkCount: r.chunkCount });
      } catch (e) {
        results.push({ nodeId, error: e instanceof Error ? e.message : 'unknown' });
      }
    }

    return Response.json({
      total: (nodesData ?? []).length,
      alreadyChunked: chunked.size,
      processed: results.length,
      results,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
