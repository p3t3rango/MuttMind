import { requireUserId } from '@/lib/auth';
import {
  createInsight,
  deleteInsight,
  getInsightAuthor,
  listInsights,
  setInsightPriming,
  updateInsight,
} from '@/lib/insights';
import { assertWorkspaceMember } from '@/lib/workspace';

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const workspaceId = new URL(req.url).searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);
    return Response.json({ insights: await listInsights({ workspaceId }) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, title, body, sourceNodeId, sourceNodeIds, sourceKind, feedsPriming } =
      await req.json();
    const text = String(body ?? '').trim();
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (!text) return Response.json({ error: 'Insight body required.' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);
    const insight = await createInsight({
      workspaceId,
      createdBy: userId,
      title: typeof title === 'string' ? title : null,
      body: text,
      sourceNodeId: typeof sourceNodeId === 'string' ? sourceNodeId : null,
      sourceNodeIds: Array.isArray(sourceNodeIds)
        ? sourceNodeIds.filter((x: unknown): x is string => typeof x === 'string')
        : null,
      sourceKind: typeof sourceKind === 'string' ? sourceKind : null,
      feedsPriming: typeof feedsPriming === 'boolean' ? feedsPriming : undefined,
    });
    return Response.json({ insight });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

async function assertCanMutate(
  insightId: string,
  workspaceId: string,
  userId: string,
  role: string,
) {
  const row = await getInsightAuthor({ id: insightId, workspaceId });
  if (!row) return { missing: true as const };
  if (row.created_by !== userId && !['owner', 'admin'].includes(role)) {
    return { forbidden: true as const };
  }
  return { ok: true as const };
}

export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, id, title, body, feedsPriming } = await req.json();
    if (!workspaceId || !id) {
      return Response.json({ error: 'workspaceId and id required' }, { status: 400 });
    }
    const role = await assertWorkspaceMember(workspaceId, userId);
    const gate = await assertCanMutate(id, workspaceId, userId, role);
    if ('missing' in gate) return Response.json({ error: 'Insight not found.' }, { status: 404 });
    if ('forbidden' in gate) {
      return Response.json({ error: 'Only the author or a Mind admin can edit this.' }, { status: 403 });
    }

    // Priming-only toggle: no body change required. Contract — priming-only
    // callers omit `body` entirely (covers both undefined and null).
    if (typeof feedsPriming === 'boolean' && body == null) {
      const insight = await setInsightPriming({ id, workspaceId, feedsPriming });
      return Response.json({ insight });
    }

    const text = String(body ?? '').trim();
    if (!text) return Response.json({ error: 'Insight body required.' }, { status: 400 });
    const insight = await updateInsight({
      id,
      workspaceId,
      title: typeof title === 'string' ? title : null,
      body: text,
    });
    return Response.json({ insight });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    const id = url.searchParams.get('id');
    if (!workspaceId || !id) return Response.json({ error: 'workspaceId and id required' }, { status: 400 });
    const role = await assertWorkspaceMember(workspaceId, userId);
    const gate = await assertCanMutate(id, workspaceId, userId, role);
    if ('missing' in gate) return Response.json({ ok: true });
    if ('forbidden' in gate) {
      return Response.json({ error: 'Only the author or a Mind admin can delete this.' }, { status: 403 });
    }
    await deleteInsight({ id, workspaceId });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
