import { requireUserId } from '@/lib/auth';
import { improveNodeSummary } from '@/lib/node-processing';
import { assertWorkspaceMember } from '@/lib/workspace';

export async function POST(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const { workspaceId } = await req.json();

    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const result = await improveNodeSummary(nodeId, workspaceId);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
