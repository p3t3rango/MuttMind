import { requireUserId } from '@/lib/auth';
import { env } from '@/lib/env';
import { generateText } from '@/lib/llm';
import { formatMemoryForPrompt, listMindMemory, writeMindMemory } from '@/lib/mind-memory';
import { buildRuntimeSystemPrompt } from '@/lib/minds-prompts';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

type WorkspaceRow = {
  id: string;
  name: string;
  system_prompt: string | null;
  provider: string | null;
  model: string | null;
};

type NodeRow = {
  id: string;
  title: string | null;
  original_url: string | null;
  ai_summary: string | null;
  source_description: string | null;
  user_notes: string | null;
  created_at: string;
};

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

    // Load the Mind so we can pull its system_prompt + provider/model.
    const { data: workspaceRow, error: workspaceError } = await getSupabaseAdmin()
      .from('workspaces')
      .select('id,name,system_prompt,provider,model')
      .eq('id', workspaceId)
      .single();
    if (workspaceError) return Response.json({ error: workspaceError.message }, { status: 500 });
    const workspace = workspaceRow as WorkspaceRow;

    // Resolve source captures. If the caller provided IDs, use those; otherwise
    // pull the Mind's most recent ~12 captures as the working set.
    let nodes: NodeRow[] = [];
    const baseSelect = 'id,title,original_url,ai_summary,source_description,user_notes,created_at';

    if (Array.isArray(sourceNodeIds) && sourceNodeIds.length) {
      const ids = sourceNodeIds.filter((id: unknown): id is string => typeof id === 'string');
      const { data, error } = await getSupabaseAdmin()
        .from('nodes')
        .select(baseSelect)
        .eq('workspace_id', workspaceId)
        .in('id', ids);
      if (error) return Response.json({ error: error.message }, { status: 500 });
      nodes = (data ?? []) as NodeRow[];
    } else {
      const { data, error } = await getSupabaseAdmin()
        .from('nodes')
        .select(baseSelect)
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(12);
      if (error) return Response.json({ error: error.message }, { status: 500 });
      nodes = (data ?? []) as NodeRow[];
    }

    if (nodes.length === 0) {
      return Response.json({ error: 'No captures in this Mind yet — save something first.' }, { status: 400 });
    }

    // Pull recent memory to anchor the agent.
    const memory = await listMindMemory({ workspaceId, limit: 10 });

    // Build the synthesis prompt.
    const systemPrompt = buildRuntimeSystemPrompt({ mindSystemPrompt: workspace.system_prompt });
    const memoryFragment = formatMemoryForPrompt(memory);
    const sourcesFragment = nodes
      .map((n, i) => {
        const lines = [`[${i + 1}] ${n.title ?? 'Untitled'}`, n.original_url ? `URL: ${n.original_url}` : ''];
        if (n.ai_summary) lines.push(`Summary: ${n.ai_summary}`);
        else if (n.source_description) lines.push(`Description: ${n.source_description}`);
        if (n.user_notes) lines.push(`User notes: ${n.user_notes}`);
        return lines.filter(Boolean).join('\n');
      })
      .join('\n\n---\n\n');

    const userPrompt =
      prompt && typeof prompt === 'string' && prompt.trim()
        ? prompt.trim()
        : 'Read these captures and write a 600-1000 word synthesis essay that surfaces the resonance between them. Use inline citations like [1], [2] referring to the numbered sources below. Name what is conspicuously absent if the corpus is thin. Use your configured voice — do not hedge into a default tone.';

    const fullPrompt = [
      memoryFragment ? `${memoryFragment}\n\n---\n\n` : '',
      `Sources from this Mind ("${workspace.name}"):\n\n${sourcesFragment}`,
      '\n\n---\n\n',
      userPrompt,
    ].join('');

    const provider = workspace.provider === 'gemini' ? 'gemini' : undefined;
    const model = workspace.model && workspace.model.trim() ? workspace.model : undefined;

    const body_md = await generateText({
      prompt: fullPrompt,
      systemPrompt,
      provider,
      model,
    });

    if (!body_md.trim()) {
      return Response.json({ error: 'LLM returned an empty essay. Try again.' }, { status: 502 });
    }

    // Derive a title from the first non-empty line (strip Markdown noise).
    const titleGuess = body_md
      .split(/\n+/)
      .map((l) => l.replace(/^#+\s*/, '').trim())
      .find((l) => l.length > 0)
      ?.slice(0, 120) ?? null;

    const { data: essay, error: insertError } = await getSupabaseAdmin()
      .from('essays')
      .insert({
        workspace_id: workspaceId,
        title: titleGuess,
        body_md,
        source_node_ids: nodes.map((n) => n.id),
        generated_by: userId,
        provider: provider ?? 'gemini',
        model: model ?? null,
        trail: { kind: prompt ? 'custom-prompt' : 'default-recent', node_count: nodes.length },
      })
      .select('id,workspace_id,title,body_md,source_node_ids,provider,model,created_at')
      .single();

    if (insertError) return Response.json({ error: insertError.message }, { status: 500 });

    // Memorize a short essay summary so the next synthesis run can reference it.
    const summary = body_md.slice(0, 280).trim();
    await writeMindMemory({
      workspaceId,
      kind: 'essay_summary',
      content: summary,
      sourceEssayId: (essay as { id: string }).id,
      createdBy: userId,
    });

    return Response.json({ essay });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
