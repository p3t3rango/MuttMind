import { requireUserId } from '@/lib/auth';
import { captureSignal } from '@/lib/capture';

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, url, rawText } = await req.json();
    const result = await captureSignal({ userId, workspaceId, url, rawText });

    return Response.json({ ok: true, nodeId: result.nodeId, warnings: result.warnings ?? [] });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
