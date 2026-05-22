import { requireUserId } from '@/lib/auth';
import { env } from '@/lib/env';
import { embeddingProcess, generateTextStream } from '@/lib/llm';
import { formatInsightsForPrompt, listInsights } from '@/lib/insights';
import { formatMemoryForPrompt, listMindMemory } from '@/lib/mind-memory';
import { buildRuntimeSystemPrompt } from '@/lib/minds-prompts';
import { getSupabaseAdmin } from '@/lib/supabase';
import { cosineSimilarity, parseEmbedding } from '@/lib/vector';
import { assertWorkspaceMember } from '@/lib/workspace';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type WorkspaceRow = { id: string; name: string; system_prompt: string | null; provider: string | null; model: string | null };
type NodeRow = { id: string; title: string | null; original_url: string | null; ai_summary: string | null; source_description: string | null; user_notes: string | null; embedding: unknown };

function line(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
}

/**
 * POST /api/chat
 * Body: { workspaceId, messages: ChatMessage[] }
 * Streams NDJSON tokens grounded in the Mind's captures + fed insights, then a
 * citations line, then done. Gated behind MUTTMIND_CHAT_ENABLED.
 */
export async function POST(req: Request) {
  if (!env.chatEnabled) {
    return Response.json(
      { error: 'Chat is not yet enabled on this server.', hint: 'Set MUTTMIND_CHAT_ENABLED=1 to activate.' },
      { status: 503 },
    );
  }

  let workspaceId: string;
  let messages: ChatMessage[];
  let userId: string;
  try {
    userId = await requireUserId(req);
    const parsed = await req.json();
    workspaceId = parsed?.workspaceId;
    messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser?.content?.trim()) return Response.json({ error: 'A user message is required' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unauthorized' }, { status: 401 });
  }
  try {
    await assertWorkspaceMember(workspaceId, userId);
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user')!;
        const query = lastUser.content.trim();

        const { data: workspaceRow, error: wErr } = await getSupabaseAdmin()
          .from('workspaces').select('id,name,system_prompt,provider,model').eq('id', workspaceId).single();
        if (wErr) throw new Error(wErr.message);
        const workspace = workspaceRow as WorkspaceRow;

        const queryEmbedding = await embeddingProcess({ text: query });
        const { data: nodesData, error: nErr } = await getSupabaseAdmin()
          .from('nodes')
          .select('id,title,original_url,ai_summary,source_description,user_notes,embedding')
          .eq('workspace_id', workspaceId);
        if (nErr) throw new Error(nErr.message);

        const ranked = (nodesData ?? [])
          .map((row) => {
            const node = row as NodeRow;
            const embedding = parseEmbedding(node.embedding);
            return { ...node, similarity: embedding.length ? cosineSimilarity(queryEmbedding, embedding) : 0 };
          })
          .filter((n) => n.similarity > 0)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 8);

        const memoryFragment = formatMemoryForPrompt(await listMindMemory({ workspaceId, limit: 8 }));
        const insightsFragment = formatInsightsForPrompt(await listInsights({ workspaceId, limit: 40 }));

        const sourcesFragment = ranked
          .map((n, i) => {
            const lines = [`[${i + 1}] ${n.title ?? 'Untitled'}`];
            if (n.original_url) lines.push(`URL: ${n.original_url}`);
            if (n.ai_summary) lines.push(`Summary: ${n.ai_summary}`);
            else if (n.source_description) lines.push(`Description: ${n.source_description}`);
            if (n.user_notes) lines.push(`User notes: ${n.user_notes}`);
            return lines.join('\n');
          })
          .join('\n\n---\n\n');

        const history = messages
          .slice(-8)
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.trim()}`)
          .join('\n\n');

        const prompt = [
          insightsFragment ? `${insightsFragment}\n\n---\n\n` : '',
          memoryFragment ? `${memoryFragment}\n\n---\n\n` : '',
          ranked.length
            ? `Sources from the Mind "${workspace.name}", ranked by relevance:\n\n${sourcesFragment}\n\n---\n\n`
            : `The Mind "${workspace.name}" has no captures matching this yet — answer from the conversation and say what's missing.\n\n---\n\n`,
          `Conversation so far:\n${history}\n\n---\n\n`,
          `Answer the latest user message grounded in the sources above. Use inline citations like [1], [2] referring to the numbered sources where you draw on them. Be tight and concrete; if the sources don't cover it, say so.`,
        ].join('');

        const systemPrompt = buildRuntimeSystemPrompt({ mindSystemPrompt: workspace.system_prompt });
        const provider = workspace.provider === 'gemini' ? 'gemini' : undefined;
        const model = workspace.model && workspace.model.trim() ? workspace.model : undefined;

        for await (const delta of generateTextStream({ prompt, systemPrompt, provider, model })) {
          controller.enqueue(line({ type: 'token', text: delta }));
        }
        controller.enqueue(
          line({
            type: 'citations',
            citations: ranked.map((n, i) => ({ index: i + 1, nodeId: n.id, title: n.title, url: n.original_url })),
          }),
        );
        controller.enqueue(line({ type: 'done' }));
      } catch (e) {
        controller.enqueue(line({ type: 'error', error: e instanceof Error ? e.message : 'unknown' }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
