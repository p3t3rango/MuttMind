import { requireUserId } from '@/lib/auth';
import { reprocessNode } from '@/lib/reprocess';
import { assertWorkspaceMember } from '@/lib/workspace';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/nodes/[nodeId]/reprocess  { workspaceId }
 * Full re-extract: re-scrape the source, regenerate summary/tags, re-embed,
 * re-chunk — the recovery path when Gemini 503'd at capture time or the
 * scrape was thin. (Improve Summary only re-runs the AI; this also re-fetches
 * the source.)
 */
export async function POST(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const { workspaceId } = await req.json();
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const result = await reprocessNode(nodeId, workspaceId);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
