import { requireUserId } from '@/lib/auth';
import { env } from '@/lib/env';
import { synthesizeEssay, type SynthesisMode } from '@/lib/synthesis';
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
      .select('id,workspace_id,title,body_md,source_node_ids,provider,model,trail,created_at')
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
    const { workspaceId, sourceNodeIds, prompt, mode } = body ?? {};
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const validModes: SynthesisMode[] = ['essay', 'brief', 'questions'];
    const resolvedMode = validModes.includes(mode) ? (mode as SynthesisMode) : 'essay';

    const result = await synthesizeEssay({
      workspaceId,
      generatedBy: userId,
      sourceNodeIds: Array.isArray(sourceNodeIds) ? sourceNodeIds : undefined,
      prompt: typeof prompt === 'string' ? prompt : undefined,
      mode: resolvedMode,
    });

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ essay: result.essay });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}

/**
 * DELETE /api/essays?workspaceId=X&id=Y
 * Remove a generated essay. The person who generated it, or a Mind
 * owner/admin, may delete.
 */
export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    const id = url.searchParams.get('id');
    if (!workspaceId || !id) {
      return Response.json({ error: 'workspaceId and id required' }, { status: 400 });
    }
    const role = await assertWorkspaceMember(workspaceId, userId);

    const { data: essay, error: fetchError } = await getSupabaseAdmin()
      .from('essays')
      .select('generated_by')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (fetchError) return Response.json({ error: fetchError.message }, { status: 500 });
    if (!essay) return Response.json({ ok: true });
    if (essay.generated_by !== userId && !['owner', 'admin'].includes(role)) {
      return Response.json(
        { error: 'Only the person who generated this, or a Mind admin, can delete it.' },
        { status: 403 },
      );
    }

    const { error } = await getSupabaseAdmin()
      .from('essays')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
