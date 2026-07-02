import { requireUserId } from '@/lib/auth';
import { buildEmbeddingInput } from '@/lib/embedding-input';
import { embeddingProcess } from '@/lib/llm';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseEmbedding } from '@/lib/vector';
import { assertWorkspaceMember } from '@/lib/workspace';

export const runtime = 'nodejs';
export const maxDuration = 300;

type BackfillRow = {
  id: string;
  embedding: unknown;
  title: string | null;
  original_url: string | null;
  source_description: string | null;
  user_notes: string | null;
  ai_summary: string | null;
  raw_text: string | null;
  node_tags?: { tags?: { shift_name?: string | null } | null }[] | null;
};

/**
 * POST /api/workspaces/[workspaceId]/backfill-embeddings
 * Re-embeds every node whose stored embedding is missing/unparseable — those
 * captures can never get semantic edges on the map. Embed-only (no re-scrape,
 * no LLM summary), so it's cheap enough to run casually from settings.
 */
export async function POST(req: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId } = await context.params;
    await assertWorkspaceMember(workspaceId, userId);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('nodes')
      .select('id,embedding,title,original_url,source_description,user_notes,ai_summary,raw_text,node_tags(tags(shift_name))')
      .eq('workspace_id', workspaceId);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as BackfillRow[];
    const missing = rows.filter((row) => parseEmbedding(row.embedding).length === 0);

    let embedded = 0;
    const failures: { nodeId: string; error: string }[] = [];
    for (const row of missing) {
      const tags = (row.node_tags ?? [])
        .map((item) => item?.tags?.shift_name)
        .filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
      const text = buildEmbeddingInput(
        [row.title, row.original_url, row.source_description, row.user_notes, row.ai_summary, tags.join(' ')],
        row.raw_text,
      );
      if (!text) {
        failures.push({ nodeId: row.id, error: 'No content to embed.' });
        continue;
      }
      try {
        const embedding = await embeddingProcess({ text });
        if (!embedding.length) {
          failures.push({ nodeId: row.id, error: 'Empty embedding returned.' });
          continue;
        }
        const { error: upErr } = await supabase.from('nodes').update({ embedding }).eq('id', row.id);
        if (upErr) failures.push({ nodeId: row.id, error: upErr.message });
        else embedded += 1;
      } catch (e) {
        failures.push({ nodeId: row.id, error: e instanceof Error ? e.message : 'unknown' });
      }
    }

    return Response.json({
      total: rows.length,
      missing: missing.length,
      embedded,
      failures,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
