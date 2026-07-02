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
type NodeRow = { id: string; title: string | null; original_url: string | null; ai_summary: string | null; source_description: string | null; user_notes: string | null; raw_text: string | null; embedding: unknown };

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
          .select('id,title,original_url,ai_summary,source_description,user_notes,raw_text,embedding')
          .eq('workspace_id', workspaceId);
        if (nErr) throw new Error(nErr.message);

        const ranked = (nodesData ?? [])
          .map((row) => {
            const node = row as NodeRow;
            const embedding = parseEmbedding(node.embedding);
            return { ...node, similarity: embedding.length ? cosineSimilarity(queryEmbedding, embedding) : 0 };
          })
          .filter((n) => n.similarity > 0)
          .sort((a, b) => b.similarity - a.similarity);

        const memoryFragment = formatMemoryForPrompt(await listMindMemory({ workspaceId, limit: 8 }));
        const insightsFragment = formatInsightsForPrompt(await listInsights({ workspaceId, limit: 40 }));

        // Relevance-tiered context. Spend the token budget in proportion to how
        // on-topic each capture is, instead of a flat top-k of summaries:
        //   full tier    — clearly about the question → verbatim full text
        //   passage tier — plausibly related → best-matching chunks
        //   index tier   — everything else → title-only line, so the model
        //                  knows the whole Mind and can point sideways.
        // Bands are relative to the best match because absolute cosine values
        // drift with embedding model and corpus.
        const topSim = ranked[0]?.similarity ?? 0;
        const FULL_BAND = 0.06;
        const PASSAGE_BAND = 0.16;
        const FULL_TIER_MAX = 4;
        const CONTENT_TIER_MAX = 10;
        const FULL_NODE_CHAR_CAP = 40_000; // ~10k tokens per fully-included source
        const SOURCE_CHAR_BUDGET = 160_000; // ~40k tokens across all sources

        const fullTier = ranked
          .filter((n) => n.similarity >= topSim - FULL_BAND)
          .slice(0, FULL_TIER_MAX);
        const fullIds = new Set(fullTier.map((n) => n.id));
        const passageTier = ranked
          .filter((n) => !fullIds.has(n.id) && n.similarity >= topSim - PASSAGE_BAND)
          .slice(0, CONTENT_TIER_MAX - fullTier.length);
        const contentNodes = [...fullTier, ...passageTier];
        const contentIds = new Set(contentNodes.map((n) => n.id));
        const indexTier = ranked.filter((n) => !contentIds.has(n.id));

        let charBudget = SOURCE_CHAR_BUDGET;
        const fullText = new Map<string, string>();
        for (const n of fullTier) {
          const text = (n.raw_text ?? '').trim();
          if (!text) continue;
          const slice = text.slice(0, Math.min(FULL_NODE_CHAR_CAP, charBudget));
          if (slice.length < 200) continue; // not worth a "full text" claim
          fullText.set(n.id, slice);
          charBudget -= slice.length;
        }

        // Passage retrieval for everything that didn't get full text (passage
        // tier, plus full-tier nodes whose raw_text was empty/missing).
        const passageIds = contentNodes.filter((n) => !fullText.has(n.id)).map((n) => n.id);
        const { data: chunkData } = passageIds.length
          ? await getSupabaseAdmin()
              .from('node_chunks')
              .select('node_id,chunk_index,content,token_estimate,embedding')
              .in('node_id', passageIds)
          : { data: [] };
        const chunks = (chunkData ?? []) as {
          node_id: string;
          chunk_index: number;
          content: string;
          token_estimate: number | null;
          embedding: unknown;
        }[];

        const scored = chunks
          .map((c) => ({ c, score: cosineSimilarity(parseEmbedding(c.embedding), queryEmbedding) }))
          .sort((a, b) => b.score - a.score);

        const MAX_PER_NODE = 2;
        const perNode = new Map<string, number>();
        const picked = new Map<string, { chunk_index: number; content: string }[]>();
        for (const { c } of scored) {
          if ((perNode.get(c.node_id) ?? 0) >= MAX_PER_NODE) continue;
          if (c.content.length > charBudget) continue;
          perNode.set(c.node_id, (perNode.get(c.node_id) ?? 0) + 1);
          charBudget -= c.content.length;
          const arr = picked.get(c.node_id) ?? [];
          arr.push({ chunk_index: c.chunk_index, content: c.content });
          picked.set(c.node_id, arr);
        }

        const sourcesFragment = contentNodes
          .map((n, i) => {
            const lines = [`[${i + 1}] ${n.title ?? 'Untitled'}`];
            if (n.original_url) lines.push(`URL: ${n.original_url}`);
            if (n.user_notes) lines.push(`User notes: ${n.user_notes}`);
            const full = fullText.get(n.id);
            const ps = (picked.get(n.id) ?? []).sort((a, b) => a.chunk_index - b.chunk_index);
            if (full) {
              lines.push(`Full text:\n${full}`);
            } else if (ps.length) {
              for (const p of ps) lines.push(`> ${p.content}`);
            } else if (n.ai_summary) {
              lines.push(`Summary: ${n.ai_summary}`);
            } else if (n.source_description) {
              lines.push(`Description: ${n.source_description}`);
            }
            return lines.join('\n');
          })
          .join('\n\n---\n\n');

        const indexFragment = indexTier.length
          ? `Also saved in this Mind (titles only — you have NOT read these; mention one only as a pointer, never cite it as a source):\n${indexTier
              .map((n) => `- ${n.title ?? 'Untitled'}${n.original_url ? ` (${n.original_url})` : ''}`)
              .join('\n')}`
          : '';

        const history = messages
          .slice(-8)
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.trim()}`)
          .join('\n\n');

        const prompt = [
          insightsFragment ? `${insightsFragment}\n\n---\n\n` : '',
          memoryFragment ? `${memoryFragment}\n\n---\n\n` : '',
          contentNodes.length
            ? `Sources from the Mind "${workspace.name}", ranked by relevance:\n\n${sourcesFragment}\n\n---\n\n`
            : `The Mind "${workspace.name}" has no captures matching this yet — answer from the conversation and say what's missing.\n\n---\n\n`,
          indexFragment ? `${indexFragment}\n\n---\n\n` : '',
          `Conversation so far:\n${history}\n\n---\n\n`,
          `Answer the user's latest message as a research assistant working their corpus. Rules:
- Lead with the substance. Open with the actual fact, idea, or claim — never with "Based on the sources" or a description of what the Mind contains.
- Pull the thing itself out of the material. Don't summarize what a source *is* or comment on the collection; extract the concrete fact, method, person, or detail and state it.
- Attribute with inline [1], [2] citations on the specific claims you draw from each source.
- Surface connections. When two saved things rhyme — same method, same question, a tension between them — name the connection and why it matters. That's the most valuable thing you can offer.
- Be honest about gaps. If the material genuinely doesn't contain what was asked, say so in one line and point to the closest thing that IS here — don't pad a thin answer into a meta-essay.
- Be concrete and brief. A sharp paragraph beats a hedged page.`,
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
            citations: contentNodes.map((n, i) => ({ index: i + 1, nodeId: n.id, title: n.title, url: n.original_url })),
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
