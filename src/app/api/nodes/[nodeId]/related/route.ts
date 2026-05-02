import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

type NodeRow = {
  id: string;
  title: string | null;
  original_url: string | null;
  ai_summary: string | null;
  source_description: string | null;
  tags: string[];
};

function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

export async function GET(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const { data: nodesData, error: nodesError } = await getSupabaseAdmin()
      .from('nodes')
      .select('id,title,original_url,ai_summary,source_description,node_tags(tags(shift_name))')
      .eq('workspace_id', workspaceId);
    if (nodesError) return Response.json({ error: nodesError.message }, { status: 500 });

    const nodeIds = (nodesData ?? []).map((node: { id: string }) => node.id);
    const { data: embeddingsData, error: embeddingsError } = nodeIds.length
      ? await getSupabaseAdmin().from('embeddings').select('node_id,embedding').in('node_id', nodeIds)
      : { data: [], error: null };

    if (embeddingsError) return Response.json({ error: embeddingsError.message }, { status: 500 });

    const nodes = (nodesData ?? []).map((node: any) => ({
      id: node.id,
      title: node.title,
      original_url: node.original_url,
      ai_summary: node.ai_summary,
      source_description: node.source_description,
      tags: Array.isArray(node.node_tags)
        ? node.node_tags
            .map((item: any) => item?.tags?.shift_name)
            .filter((tag: unknown): tag is string => typeof tag === 'string' && tag.length > 0)
        : [],
    })) as NodeRow[];

    const embeddingMap = new Map<string, number[]>(
      (embeddingsData ?? []).map((row: any) => [
        row.node_id,
        Array.isArray(row.embedding)
          ? row.embedding.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value))
          : [],
      ]),
    );

    const targetEmbedding = embeddingMap.get(nodeId);
    if (!targetEmbedding?.length) return Response.json({ related: [] });

    const targetNode = nodes.find((node) => node.id === nodeId);
    const related = nodes
      .filter((node) => node.id !== nodeId)
      .map((node) => {
        const embedding = embeddingMap.get(node.id) ?? [];
        const sharedTags = targetNode ? targetNode.tags.filter((tag) => node.tags.includes(tag)) : [];
        return {
          ...node,
          similarity: cosineSimilarity(targetEmbedding, embedding),
          sharedTags,
        };
      })
      .filter((node) => node.similarity >= 0.74 || node.sharedTags.length > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 8);

    return Response.json({ related });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
