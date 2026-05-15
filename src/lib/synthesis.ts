import { generateText } from '@/lib/llm';
import { formatMemoryForPrompt, listMindMemory, writeMindMemory } from '@/lib/mind-memory';
import { buildRuntimeSystemPrompt } from '@/lib/minds-prompts';
import { getSupabaseAdmin } from '@/lib/supabase';

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

export type Essay = {
  id: string;
  workspace_id: string;
  title: string | null;
  body_md: string;
  source_node_ids: string[];
  provider: string | null;
  model: string | null;
  created_at: string;
};

export type SynthesizeResult =
  | { ok: true; essay: Essay }
  | { ok: false; status: number; error: string };

/**
 * Core synthesis. Pulls a Mind's source captures (caller IDs or recent slice),
 * anchors with recent memory, builds the runtime prompt from the Mind's
 * configuration, calls the LLM, persists the essay, and writes an
 * essay_summary back to memory.
 *
 * Shared by POST /api/essays and the weekly digest cron so behavior can't
 * drift between the two.
 */
export async function synthesizeEssay(input: {
  workspaceId: string;
  generatedBy?: string | null;
  sourceNodeIds?: string[];
  prompt?: string;
}): Promise<SynthesizeResult> {
  const { workspaceId, generatedBy = null, sourceNodeIds, prompt } = input;

  const { data: workspaceRow, error: workspaceError } = await getSupabaseAdmin()
    .from('workspaces')
    .select('id,name,system_prompt,provider,model')
    .eq('id', workspaceId)
    .single();
  if (workspaceError) return { ok: false, status: 500, error: workspaceError.message };
  const workspace = workspaceRow as WorkspaceRow;

  const baseSelect = 'id,title,original_url,ai_summary,source_description,user_notes,created_at';
  let nodes: NodeRow[] = [];

  if (Array.isArray(sourceNodeIds) && sourceNodeIds.length) {
    const ids = sourceNodeIds.filter((id): id is string => typeof id === 'string');
    const { data, error } = await getSupabaseAdmin()
      .from('nodes')
      .select(baseSelect)
      .eq('workspace_id', workspaceId)
      .in('id', ids);
    if (error) return { ok: false, status: 500, error: error.message };
    nodes = (data ?? []) as NodeRow[];
  } else {
    const { data, error } = await getSupabaseAdmin()
      .from('nodes')
      .select(baseSelect)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(12);
    if (error) return { ok: false, status: 500, error: error.message };
    nodes = (data ?? []) as NodeRow[];
  }

  if (nodes.length === 0) {
    return { ok: false, status: 400, error: 'No captures in this Mind yet — save something first.' };
  }

  const memory = await listMindMemory({ workspaceId, limit: 10 });
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
    prompt && prompt.trim()
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

  const body_md = await generateText({ prompt: fullPrompt, systemPrompt, provider, model });
  if (!body_md.trim()) {
    return { ok: false, status: 502, error: 'LLM returned an empty essay.' };
  }

  const titleGuess =
    body_md
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
      generated_by: generatedBy,
      provider: provider ?? 'gemini',
      model: model ?? null,
      trail: { kind: prompt ? 'custom-prompt' : 'default-recent', node_count: nodes.length },
    })
    .select('id,workspace_id,title,body_md,source_node_ids,provider,model,created_at')
    .single();

  if (insertError) return { ok: false, status: 500, error: insertError.message };

  const summary = body_md.slice(0, 280).trim();
  await writeMindMemory({
    workspaceId,
    kind: 'essay_summary',
    content: summary,
    sourceEssayId: (essay as { id: string }).id,
    createdBy: generatedBy,
  });

  return { ok: true, essay: essay as Essay };
}
