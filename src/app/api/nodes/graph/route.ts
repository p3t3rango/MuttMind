import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseEmbedding } from '@/lib/vector';
import { assertWorkspaceMember } from '@/lib/workspace';

type NodeTagRow = {
  tags?: { shift_name?: string | null } | null;
};

type RawNode = {
  id: string;
  title: string | null;
  original_url: string | null;
  og_image_url: string | null;
  embedding: unknown;
  created_at: string;
  node_tags?: NodeTagRow[] | null;
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
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Returns nodes + cosine-similarity edges for a workspace's graph view.
 *
 * Replaces the prior client-side keyword-matching heuristic with real semantic
 * edges over the embeddings already stored on each node.
 *
 * Query params:
 *   - workspaceId (required)
 *   - threshold (optional, default 0.78) — cosine cutoff
 *   - maxEdgesPerNode (optional, default 4) — top-N edges per node by weight
 */
export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });

    // Lower default threshold than the original 0.78 — that was too strict and
    // left most nodes isolated. 0.62 plus tag-shared edges gives an
    // Obsidian-like density without being noise.
    const threshold = Number(url.searchParams.get('threshold') ?? '0.62');
    const maxEdgesPerNode = Number(url.searchParams.get('maxEdgesPerNode') ?? '6');

    await assertWorkspaceMember(workspaceId, userId);

    const { data, error } = await getSupabaseAdmin()
      .from('nodes')
      .select('id,title,original_url,og_image_url,embedding,created_at,node_tags(tags(shift_name))')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) return Response.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []) as unknown as RawNode[];
    const nodes = rows.map((r) => ({
      id: r.id,
      title: r.title,
      original_url: r.original_url,
      og_image_url: r.og_image_url,
      created_at: r.created_at,
      embedding: parseEmbedding(r.embedding),
      tags: Array.isArray(r.node_tags)
        ? r.node_tags
            .map((nt) => nt?.tags?.shift_name)
            .filter((t): t is string => typeof t === 'string' && t.length > 0)
        : [],
    }));

    // Edge candidates keyed by node, accumulating the best weight per pair.
    const edgeCandidates = new Map<string, Array<{ to: string; weight: number }>>();
    const pushCandidate = (a: string, b: string, weight: number) => {
      const aList = edgeCandidates.get(a) ?? [];
      aList.push({ to: b, weight });
      edgeCandidates.set(a, aList);
      const bList = edgeCandidates.get(b) ?? [];
      bList.push({ to: a, weight });
      edgeCandidates.set(b, bList);
    };

    const validNodes = nodes.filter((n) => n.embedding.length > 0);
    for (let i = 0; i < validNodes.length; i += 1) {
      const a = validNodes[i];
      for (let j = i + 1; j < validNodes.length; j += 1) {
        const b = validNodes[j];
        const sim = cosineSimilarity(a.embedding, b.embedding);
        if (sim >= threshold) pushCandidate(a.id, b.id, sim);
      }
    }

    // Tag-shared edges — nodes sharing one or more tags are connected. Weight
    // scales with the count of shared tags so multi-tag overlaps pull tighter.
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      if (!a.tags.length) continue;
      const aTags = new Set(a.tags);
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        if (!b.tags.length) continue;
        const shared = b.tags.filter((t) => aTags.has(t)).length;
        if (shared > 0) pushCandidate(a.id, b.id, 0.6 + Math.min(shared, 4) * 0.1);
      }
    }

    // Cap each node's edges to the top N, then dedupe (a-b appears for both nodes).
    const seen = new Set<string>();
    const edges: Array<{ from: string; to: string; weight: number }> = [];

    for (const [nodeId, list] of edgeCandidates.entries()) {
      const top = list.sort((x, y) => y.weight - x.weight).slice(0, maxEdgesPerNode);
      for (const e of top) {
        const key = nodeId < e.to ? `${nodeId}|${e.to}` : `${e.to}|${nodeId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: nodeId, to: e.to, weight: e.weight });
      }
    }

    return Response.json({
      nodes: nodes.map((n) => ({
        id: n.id,
        title: n.title,
        original_url: n.original_url,
        og_image_url: n.og_image_url,
        created_at: n.created_at,
      })),
      edges,
      meta: {
        threshold,
        maxEdgesPerNode,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
