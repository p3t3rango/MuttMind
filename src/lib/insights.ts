import { getSupabaseAdmin } from './supabase';

export type Insight = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  title: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  author?: { display_name: string | null; email: string | null } | null;
};

const SELECT = 'id,workspace_id,created_by,title,body,created_at,updated_at,users(display_name,email)';

function shape(row: Record<string, unknown>): Insight {
  const u = (row.users ?? null) as { display_name?: string | null; email?: string | null } | null;
  return {
    id: row.id as string,
    workspace_id: row.workspace_id as string,
    created_by: (row.created_by ?? null) as string | null,
    title: (row.title ?? null) as string | null,
    body: row.body as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    author: u ? { display_name: u.display_name ?? null, email: u.email ?? null } : null,
  };
}

export async function listInsights(input: {
  workspaceId: string;
  limit?: number;
}): Promise<Insight[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('insights')
    .select(SELECT)
    .eq('workspace_id', input.workspaceId)
    .order('created_at', { ascending: false })
    .limit(input.limit ?? 100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => shape(r as Record<string, unknown>));
}

export async function createInsight(input: {
  workspaceId: string;
  createdBy: string;
  title?: string | null;
  body: string;
}): Promise<Insight> {
  const { data, error } = await getSupabaseAdmin()
    .from('insights')
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.createdBy,
      title: input.title?.trim() || null,
      body: input.body.trim(),
    })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return shape(data as Record<string, unknown>);
}

export async function updateInsight(input: {
  id: string;
  workspaceId: string;
  title?: string | null;
  body: string;
}): Promise<Insight> {
  const { data, error } = await getSupabaseAdmin()
    .from('insights')
    .update({ title: input.title?.trim() || null, body: input.body.trim() })
    .eq('id', input.id)
    .eq('workspace_id', input.workspaceId)
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return shape(data as Record<string, unknown>);
}

export async function deleteInsight(input: { id: string; workspaceId: string }): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('insights')
    .delete()
    .eq('id', input.id)
    .eq('workspace_id', input.workspaceId);
  if (error) throw new Error(error.message);
}

export async function getInsightAuthor(input: {
  id: string;
  workspaceId: string;
}): Promise<{ created_by: string | null } | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('insights')
    .select('created_by')
    .eq('id', input.id)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { created_by: string | null } | null) ?? null;
}

/**
 * High-priority prompt block: the user's own written thinking about this Mind.
 * Treated as load-bearing priming, distinct from system memory. Capped so a
 * long journal can't crowd out the source material.
 */
export function formatInsightsForPrompt(entries: Insight[], cap = 4_000): string {
  if (!entries.length) return '';
  const parts: string[] = [];
  let used = 0;
  for (const e of entries) {
    const head = e.title?.trim() ? `${e.title.trim()}: ` : '';
    const line = `- ${head}${e.body.trim()}`;
    if (used + line.length > cap) break;
    parts.push(line);
    used += line.length;
  }
  if (!parts.length) return '';
  return `The user's own insights on this Mind (their explicit framing — treat as load-bearing, not optional):\n${parts.join('\n')}`;
}
