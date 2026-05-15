import { requireUserId } from '@/lib/auth';
import { env } from '@/lib/env';
import { embeddingProcess, generateText } from '@/lib/llm';
import { formatMemoryForPrompt, listMindMemory } from '@/lib/mind-memory';
import { buildRuntimeSystemPrompt } from '@/lib/minds-prompts';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseEmbedding } from '@/lib/vector';
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
  embedding: unknown;
};

function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/**
 * POST /api/ask
 * Body: { workspaceId, query }
 *
 * Embeds the query, retrieves top-N most similar captures from the Mind,
 * builds a Q&A prompt with those captures + recent memory, calls the LLM,
 * returns answer + structured citations.
 *
 * Two LLM calls per ask: one embedding, one completion.
 *
 * Gated behind MUTTMIND_ASK_ENABLED. While disabled, returns 503 — the
 * scaffolding ships dormant.
 */
export async function POST(req: Request) {
  if (!env.askEnabled) {
    return Response.json(
      {
        error: 'Ask is not yet enabled on this server.',
        hint: 'Set MUTTMIND_ASK_ENABLED=1 to activate.',
      },
      { status: 503 },
    );
  }

  try {
    const userId = await requireUserId(req);
    const body = await req.json();
    const { workspaceId, query } = body ?? {};
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (typeof query !== 'string' || !query.trim()) {
      return Response.json({ error: 'query required' }, { status: 400 });
    }
    await assertWorkspaceMember(workspaceId, userId);

    const { data: workspaceRow, error: workspaceError } = await getSupabaseAdmin()
      .from('workspaces')
      .select('id,name,system_prompt,provider,model')
      .eq('id', workspaceId)
      .single();
    if (workspaceError) return Response.json({ error: workspaceError.message }, { status: 500 });
    const workspace = workspaceRow as WorkspaceRow;

    // Embed the query.
    const queryEmbedding = await embeddingProcess({ text: query });
    if (!queryEmbedding.length) {
      return Response.json({ error: 'Could not embed the query.' }, { status: 502 });
    }

    // Pull all nodes with embeddings; rank by cosine similarity.
    const { data: nodesData, error: nodesError } = await getSupabaseAdmin()
      .from('nodes')
      .select('id,title,original_url,ai_summary,source_description,user_notes,embedding')
      .eq('workspace_id', workspaceId);
    if (nodesError) return Response.json({ error: nodesError.message }, { status: 500 });

    const ranked = (nodesData ?? [])
      .map((row) => {
        const node = row as NodeRow;
        const embedding = parseEmbedding(node.embedding);
        return {
          ...node,
          similarity: embedding.length ? cosineSimilarity(queryEmbedding, embedding) : 0,
        };
      })
      .filter((n) => n.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 8);

    if (ranked.length === 0) {
      return Response.json({
        answer: "The Mind doesn't have anything matching that query yet.",
        citations: [],
      });
    }

    const memory = await listMindMemory({ workspaceId, limit: 8 });
    const memoryFragment = formatMemoryForPrompt(memory);

    const sourcesFragment = ranked
      .map((n, i) => {
        const lines = [`[${i + 1}] ${n.title ?? 'Untitled'}`];
        if (n.original_url) lines.push(`URL: ${n.original_url}`);
        if (n.ai_summary) lines.push(`Summary: ${n.ai_summary}`);
        else if (n.source_description) lines.push(`Description: ${n.source_description}`);
        if (n.user_notes) lines.push(`User notes: ${n.user_notes}`);
        return lines.filter(Boolean).join('\n');
      })
      .join('\n\n---\n\n');

    const userPrompt = [
      memoryFragment ? `${memoryFragment}\n\n---\n\n` : '',
      `Sources from the Mind "${workspace.name}", ranked by relevance to the question:\n\n${sourcesFragment}`,
      '\n\n---\n\n',
      `Question: ${query.trim()}\n\nAnswer the question grounded ONLY in the sources above. Use inline citations like [1], [2] referring to the numbered sources. If the sources don't address the question, say so — don't pad. Keep it tight: 200-400 words unless the question genuinely needs more.`,
    ].join('');

    const systemPrompt = buildRuntimeSystemPrompt({ mindSystemPrompt: workspace.system_prompt });
    const provider = workspace.provider === 'gemini' ? 'gemini' : undefined;
    const model = workspace.model && workspace.model.trim() ? workspace.model : undefined;

    const answer = (
      await generateText({
        prompt: userPrompt,
        systemPrompt,
        provider,
        model,
      })
    ).trim();

    return Response.json({
      answer,
      citations: ranked.map((n, i) => ({
        index: i + 1,
        nodeId: n.id,
        title: n.title,
        url: n.original_url,
        similarity: n.similarity,
      })),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
