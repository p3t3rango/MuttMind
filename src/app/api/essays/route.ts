import { requireUserId } from '@/lib/auth';
import { env } from '@/lib/env';
import { synthesizeEssay } from '@/lib/synthesis';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

/**
 * GET /api/essays?workspaceId=X
 * List recent essays for a Mind. No LLM cost.
 */
export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const { data, error } = await getSupabaseAdmin()
      .from('essays')
      .select('id,workspace_id,title,body_md,source_node_ids,provider,model,created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ essays: data ?? [] });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

/**
 * POST /api/essays
 * Generate a new synthesis essay over a Mind's recent captures.
 *
 * Gated behind MUTTMIND_SYNTHESIS_ENABLED=1. While disabled, returns 503 so
 * the rest of the app can ship without any chance of an accidental LLM call.
 */
export async function POST(req: Request) {
  if (!env.synthesisEnabled) {
    return Response.json(
      {
        error: 'Synthesis is not yet enabled on this server.',
        hint: 'Set MUTTMIND_SYNTHESIS_ENABLED=1 to activate.',
      },
      { status: 503 },
    );
  }

  try {
    const userId = await requireUserId(req);
    const body = await req.json();
    const { workspaceId, sourceNodeIds, prompt } = body ?? {};
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const result = await synthesizeEssay({
      workspaceId,
      generatedBy: userId,
      sourceNodeIds: Array.isArray(sourceNodeIds) ? sourceNodeIds : undefined,
      prompt: typeof prompt === 'string' ? prompt : undefined,
    });

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ essay: result.essay });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
