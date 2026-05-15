import { requireUserId } from '@/lib/auth';
import { env } from '@/lib/env';
import { LENSES, lensByKey } from '@/lib/lens-prompts';
import { generateText } from '@/lib/llm';
import { buildRuntimeSystemPrompt } from '@/lib/minds-prompts';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

type NodeRow = {
  id: string;
  workspace_id: string;
  title: string | null;
  original_url: string | null;
  ai_summary: string | null;
  source_description: string | null;
  raw_text: string | null;
  user_notes: string | null;
};

type WorkspaceRow = {
  id: string;
  name: string;
  system_prompt: string | null;
  provider: string | null;
  model: string | null;
};

/**
 * GET /api/nodes/{nodeId}/lens?workspaceId=X
 * Lists cached lens outputs for this capture. Zero LLM cost.
 */
export async function GET(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const { data, error } = await getSupabaseAdmin()
      .from('node_lens_outputs')
      .select('id,node_id,lens,output,provider,model,created_at')
      .eq('workspace_id', workspaceId)
      .eq('node_id', nodeId)
      .order('created_at', { ascending: false });

    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({
      outputs: data ?? [],
      catalog: LENSES.map((l) => ({ key: l.key, label: l.label, description: l.description })),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

/**
 * POST /api/nodes/{nodeId}/lens
 * Body: { workspaceId, lens, regenerate?: boolean }
 *
 * Returns cached output if one exists for this lens (unless regenerate is true).
 * Otherwise generates via the configured LLM and persists.
 *
 * Gated behind MUTTMIND_LENSES_ENABLED. While disabled, returns 503.
 */
export async function POST(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  if (!env.lensesEnabled) {
    return Response.json(
      {
        error: 'Insight Lenses are not yet enabled on this server.',
        hint: 'Set MUTTMIND_LENSES_ENABLED=1 to activate.',
      },
      { status: 503 },
    );
  }

  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const body = await req.json();
    const { workspaceId, lens: lensKey, regenerate } = body ?? {};

    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (typeof lensKey !== 'string') return Response.json({ error: 'lens required' }, { status: 400 });
    const lens = lensByKey(lensKey);
    if (!lens) return Response.json({ error: `Unknown lens: ${lensKey}` }, { status: 400 });

    await assertWorkspaceMember(workspaceId, userId);

    // Cache hit?
    if (!regenerate) {
      const { data: cached } = await getSupabaseAdmin()
        .from('node_lens_outputs')
        .select('id,node_id,lens,output,provider,model,created_at')
        .eq('workspace_id', workspaceId)
        .eq('node_id', nodeId)
        .eq('lens', lens.key)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cached) return Response.json({ output: cached, fromCache: true });
    }

    // Load the capture + the Mind for context.
    const [{ data: nodeRow, error: nodeError }, { data: workspaceRow, error: workspaceError }] = await Promise.all([
      getSupabaseAdmin()
        .from('nodes')
        .select('id,workspace_id,title,original_url,ai_summary,source_description,raw_text,user_notes')
        .eq('id', nodeId)
        .single(),
      getSupabaseAdmin()
        .from('workspaces')
        .select('id,name,system_prompt,provider,model')
        .eq('id', workspaceId)
        .single(),
    ]);

    if (nodeError) return Response.json({ error: nodeError.message }, { status: 500 });
    if (workspaceError) return Response.json({ error: workspaceError.message }, { status: 500 });

    const node = nodeRow as NodeRow;
    const workspace = workspaceRow as WorkspaceRow;
    if (node.workspace_id !== workspaceId) {
      return Response.json({ error: 'Capture is not part of this Mind.' }, { status: 403 });
    }

    const userPrompt = lens.prompt({
      title: node.title,
      url: node.original_url,
      summary: node.ai_summary,
      description: node.source_description,
      rawText: node.raw_text,
      userNotes: node.user_notes,
      mindName: workspace.name,
      mindSystemPromptExcerpt: workspace.system_prompt,
    });

    const systemPrompt = buildRuntimeSystemPrompt({ mindSystemPrompt: workspace.system_prompt });
    const provider = workspace.provider === 'gemini' ? 'gemini' : undefined;
    const model = workspace.model && workspace.model.trim() ? workspace.model : undefined;

    const output = (
      await generateText({
        prompt: userPrompt,
        systemPrompt,
        provider,
        model,
      })
    ).trim();

    if (!output) {
      return Response.json({ error: 'LLM returned an empty response.' }, { status: 502 });
    }

    const { data: inserted, error: insertError } = await getSupabaseAdmin()
      .from('node_lens_outputs')
      .insert({
        node_id: nodeId,
        workspace_id: workspaceId,
        lens: lens.key,
        output,
        generated_by: userId,
        provider: provider ?? 'gemini',
        model: model ?? null,
      })
      .select('id,node_id,lens,output,provider,model,created_at')
      .single();

    if (insertError) return Response.json({ error: insertError.message }, { status: 500 });

    return Response.json({ output: inserted, fromCache: false });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
