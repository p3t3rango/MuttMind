import { requireUserId } from '@/lib/auth';
import {
  createInsight,
  deleteInsight,
  getInsightAuthor,
  listInsights,
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
    const { workspaceId, title, body } = await req.json();
    const text = String(body ?? '').trim();
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (!text) return Response.json({ error: 'Insight body required.' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);
    const insight = await createInsight({
      workspaceId,
      createdBy: userId,
      title: typeof title === 'string' ? title : null,
      body: text,
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
    const { workspaceId, id, title, body } = await req.json();
    const text = String(body ?? '').trim();
    if (!workspaceId || !id) return Response.json({ error: 'workspaceId and id required' }, { status: 400 });
    if (!text) return Response.json({ error: 'Insight body required.' }, { status: 400 });
    const role = await assertWorkspaceMember(workspaceId, userId);
    const gate = await assertCanMutate(id, workspaceId, userId, role);
    if ('missing' in gate) return Response.json({ error: 'Insight not found.' }, { status: 404 });
    if ('forbidden' in gate) {
      return Response.json({ error: 'Only the author or a Mind admin can edit this.' }, { status: 403 });
    }
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
