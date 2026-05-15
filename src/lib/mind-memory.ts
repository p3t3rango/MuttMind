import { getSupabaseAdmin } from './supabase';

export type MindMemoryKind = 'fact' | 'essay_summary' | 'observation';

export type MindMemoryEntry = {
  id: string;
  workspace_id: string;
  kind: MindMemoryKind;
  content: string;
  source_node_id: string | null;
  source_essay_id: string | null;
  weight: number;
  created_at: string;
  expires_at: string | null;
};

/**
 * Write a memory entry. Embedding is left null for now — a background pass
 * will fill it in later. This keeps writes cheap and deferrable.
 */
export async function writeMindMemory(input: {
  workspaceId: string;
  kind: MindMemoryKind;
  content: string;
  sourceNodeId?: string | null;
  sourceEssayId?: string | null;
  createdBy?: string | null;
  weight?: number;
  expiresAt?: string | null;
}): Promise<MindMemoryEntry | null> {
  const trimmed = input.content.trim();
  if (!trimmed) return null;

  const { data, error } = await getSupabaseAdmin()
    .from('mind_memory')
    .insert({
      workspace_id: input.workspaceId,
      kind: input.kind,
      content: trimmed,
      source_node_id: input.sourceNodeId ?? null,
      source_essay_id: input.sourceEssayId ?? null,
      created_by: input.createdBy ?? null,
      weight: input.weight ?? 1.0,
      expires_at: input.expiresAt ?? null,
    })
    .select('id,workspace_id,kind,content,source_node_id,source_essay_id,weight,created_at,expires_at')
    .single();

  if (error) throw error;
  return data as unknown as MindMemoryEntry;
}

/**
 * Read recent memory entries for a Mind. Used by synthesis prompts to anchor
 * the agent in what the Mind has been thinking about.
 *
 * Filters out expired entries automatically.
 */
export async function listMindMemory(input: {
  workspaceId: string;
  kind?: MindMemoryKind;
  limit?: number;
}): Promise<MindMemoryEntry[]> {
  let query = getSupabaseAdmin()
    .from('mind_memory')
    .select('id,workspace_id,kind,content,source_node_id,source_essay_id,weight,created_at,expires_at')
    .eq('workspace_id', input.workspaceId)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false })
    .limit(input.limit ?? 20);

  if (input.kind) {
    query = query.eq('kind', input.kind);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as MindMemoryEntry[];
}

/**
 * Delete a memory entry. Use when the user explicitly wants to invalidate
 * something the agent remembered.
 */
export async function deleteMindMemory(input: { workspaceId: string; memoryId: string }): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('mind_memory')
    .delete()
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.memoryId);
  if (error) throw error;
  return true;
}

/**
 * Format memory entries as a compact prompt fragment to inject into LLM
 * context for synthesis or Q&A. Group by kind so the agent can weight them.
 */
export function formatMemoryForPrompt(entries: MindMemoryEntry[]): string {
  if (entries.length === 0) return '';

  const facts = entries.filter((e) => e.kind === 'fact');
  const essays = entries.filter((e) => e.kind === 'essay_summary');
  const observations = entries.filter((e) => e.kind === 'observation');

  const sections: string[] = [];
  if (facts.length) {
    sections.push(`Facts the Mind remembers:\n${facts.map((f) => `- ${f.content}`).join('\n')}`);
  }
  if (observations.length) {
    sections.push(`Observations the agent has flagged:\n${observations.map((o) => `- ${o.content}`).join('\n')}`);
  }
  if (essays.length) {
    sections.push(`Recent essay summaries:\n${essays.map((e) => `- ${e.content}`).join('\n')}`);
  }

  return sections.join('\n\n');
}
