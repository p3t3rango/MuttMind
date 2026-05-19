import { embeddingProcess, generateText } from '@/lib/llm';
import { formatInsightsForPrompt, listInsights } from '@/lib/insights';
import { formatMemoryForPrompt, listMindMemory, writeMindMemory } from '@/lib/mind-memory';
import { buildRuntimeSystemPrompt } from '@/lib/minds-prompts';
import { getSupabaseAdmin } from '@/lib/supabase';
import { centroid, cosineSimilarity, parseEmbedding } from '@/lib/vector';

type WorkspaceRow = {
  id: string;
  name: string;
  system_prompt: string | null;
  provider: string | null;
  model: string | null;
  learning_enabled: boolean | null;
};

type NodeRow = {
  id: string;
  title: string | null;
  original_url: string | null;
  ai_summary: string | null;
  source_description: string | null;
  user_notes: string | null;
  raw_text: string | null;
  embedding: unknown;
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
  trail: { kind?: string; origin?: string } | null;
  created_at: string;
};

export type SynthesizeResult =
  | { ok: true; essay: Essay }
  | { ok: false; status: number; error: string };

export type SynthesisMode = 'essay' | 'brief' | 'questions';

const ANTI_META = `Write about the ideas themselves. Do not make the collection the subject of a sentence — no "the Mind," "this corpus," "these captures," "the current state of," "as a researcher looking at this." The reader knows where the material came from; your job is to make the ideas talk to each other. Open on a real idea or tension, never on a description of what was saved. This applies to your closing as much as your opening — do not end by stepping back to describe the collection or its "focus"; land on the idea, not on the container. Cite sources with bracketed numerals only — [1], or [2][5] for several. Never use bare numbers, never [1, 2], never "(source 3)"; every citation must be a [n] in square brackets so it can be linked. If a clear through-line has an obvious missing piece, name it as part of the argument ("what this line of thinking never confronts is…"), not as a status report on the collection.`;

const PROPORTIONAL = `Stay proportional to the material. Length targets are a ceiling, not a quota — never pad, never manufacture profundity, never spin abstract scaffolding the sources don't support. If the material only sustains a tight piece, write the tight piece. Every claim should be traceable to something actually in a source, not to general knowledge you're using to fill space.`;

const MODE_PROMPTS: Record<SynthesisMode, string> = {
  essay: `Write an essay (up to ~1000 words) that thinks through this material — the real argument that emerges when you put these pieces next to each other. ${ANTI_META} ${PROPORTIONAL} Commit to your configured voice the whole way through; do not drift into a neutral explainer tone.`,
  brief: `Write a tight brief (up to ~350 words): the single strongest through-line across this material and why it matters right now. One idea, argued well, not a tour of everything. ${ANTI_META} ${PROPORTIONAL}`,
  questions: `Surface the sharpest open questions this material is circling but never resolves (up to 8, fewer if the material only earns fewer). For each: one or two sentences of framing that earns the question, with citations to the pieces that raise it. These should be questions a smart peer would actually chase next — not generic prompts. ${ANTI_META} ${PROPORTIONAL}`,
};

const THIN_NOTE = `IMPORTANT: there are very few sources here — too few for genuine cross-source synthesis. Do not fake it. Do a sharp, honest close reading of what is actually present: what it argues, what's interesting or weak in it, what it assumes. Then state plainly what kinds of captures would unlock real synthesis around this. Keep it short and grounded — a few tight paragraphs, no sweeping meditation, no inflating one page into a thesis.`;

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
  mode?: SynthesisMode;
  /** 'digest' marks this as the scheduled weekly Mind Digest, not an ad-hoc essay. */
  origin?: 'digest';
}): Promise<SynthesizeResult> {
  const {
    workspaceId,
    generatedBy = null,
    sourceNodeIds,
    prompt,
    mode = 'essay',
    origin,
  } = input;

  const { data: workspaceRow, error: workspaceError } = await getSupabaseAdmin()
    .from('workspaces')
    .select('id,name,system_prompt,provider,model,learning_enabled')
    .eq('id', workspaceId)
    .single();
  if (workspaceError) return { ok: false, status: 500, error: workspaceError.message };
  const workspace = workspaceRow as WorkspaceRow;

  const baseSelect =
    'id,title,original_url,ai_summary,source_description,user_notes,raw_text,embedding,created_at';
  const MAX_SOURCES = 12;
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
    // Default selection: pull the whole Mind, then pick the cluster around its
    // current center of gravity (centroid of the most recent embedded nodes)
    // rather than just the newest N. Falls back to recency when there aren't
    // enough embeddings to form a meaningful centroid.
    const { data, error } = await getSupabaseAdmin()
      .from('nodes')
      .select(baseSelect)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) return { ok: false, status: 500, error: error.message };
    const all = (data ?? []) as NodeRow[];

    const withEmbedding = all
      .map((n) => ({ node: n, emb: parseEmbedding(n.embedding) }))
      .filter((x) => x.emb.length > 0);

    if (withEmbedding.length < 3) {
      nodes = all.slice(0, MAX_SOURCES);
    } else {
      const seed = centroid(withEmbedding.slice(0, 5).map((x) => x.emb));
      nodes = withEmbedding
        .map((x) => ({ node: x.node, score: cosineSimilarity(x.emb, seed) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SOURCES)
        .map((x) => x.node);
    }
  }

  if (nodes.length === 0) {
    return { ok: false, status: 400, error: 'No captures in this Mind yet — save something first.' };
  }

  const memory = await listMindMemory({ workspaceId, limit: 10 });
  const insights = await listInsights({ workspaceId, limit: 20 });
  const systemPrompt = buildRuntimeSystemPrompt({ mindSystemPrompt: workspace.system_prompt });
  const memoryFragment = formatMemoryForPrompt(memory);
  const insightsFragment = formatInsightsForPrompt(insights);
  // Stage 1 fallback: bounded raw_text excerpt per source. Per-source cap
  // scales down with corpus size so the block stays ~24k chars regardless.
  const buildExcerptFragment = () => {
    const excerptCap = Math.min(1800, Math.max(300, Math.floor(22000 / nodes.length)));
    return nodes
      .map((n, i) => {
        const lines = [`[${i + 1}] ${n.title ?? 'Untitled'}`, n.original_url ? `URL: ${n.original_url}` : ''];
        if (n.ai_summary) lines.push(`Summary: ${n.ai_summary}`);
        else if (n.source_description) lines.push(`Description: ${n.source_description}`);
        if (n.user_notes) lines.push(`User notes: ${n.user_notes}`);
        const body = (n.raw_text ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (body.length > 40) {
          const excerpt = body.length > excerptCap ? `${body.slice(0, excerptCap)}…` : body;
          lines.push(`Excerpt: ${excerpt}`);
        }
        return lines.filter(Boolean).join('\n');
      })
      .join('\n\n---\n\n');
  };

  // Stage 2: retrieve the most relevant passages across the selected nodes
  // instead of feeding document heads. Citations stay [n]→node.
  let sourcesFragment: string;
  let retrievalUsed = false;
  {
    const { data: chunkData } = await getSupabaseAdmin()
      .from('node_chunks')
      .select('node_id,chunk_index,content,token_estimate,embedding')
      .in(
        'node_id',
        nodes.map((n) => n.id),
      );
    const chunks = (chunkData ?? []) as {
      node_id: string;
      chunk_index: number;
      content: string;
      token_estimate: number | null;
      embedding: unknown;
    }[];

    if (chunks.length && new Set(chunks.map((c) => c.node_id)).size >= 3) {
      // Query vector: a custom prompt's embedding, else the centroid of the
      // selected nodes' own embeddings (the cluster's center of gravity).
      let queryVec: number[] = [];
      if (prompt && prompt.trim()) {
        queryVec = await embeddingProcess({ text: prompt.trim() }).catch(() => []);
      }
      if (queryVec.length === 0) {
        queryVec = centroid(
          nodes.map((n) => parseEmbedding(n.embedding)).filter((v) => v.length > 0),
        );
      }

      const scored = chunks
        .map((c) => ({ c, score: cosineSimilarity(parseEmbedding(c.embedding), queryVec) }))
        .sort((a, b) => b.score - a.score);

      const TOKEN_BUDGET = 12_000;
      const MAX_PER_NODE = 3;
      const perNode = new Map<string, number>();
      const picked = new Map<string, { chunk_index: number; content: string }[]>();
      let usedTokens = 0;
      for (const { c } of scored) {
        if ((perNode.get(c.node_id) ?? 0) >= MAX_PER_NODE) continue;
        const tok = c.token_estimate ?? Math.ceil(c.content.length / 4);
        if (usedTokens + tok > TOKEN_BUDGET) continue;
        perNode.set(c.node_id, (perNode.get(c.node_id) ?? 0) + 1);
        usedTokens += tok;
        const arr = picked.get(c.node_id) ?? [];
        arr.push({ chunk_index: c.chunk_index, content: c.content });
        picked.set(c.node_id, arr);
      }

      if (usedTokens > 0) {
        retrievalUsed = true;
        sourcesFragment = nodes
          .map((n, i) => {
            const lines = [
              `[${i + 1}] ${n.title ?? 'Untitled'}`,
              n.original_url ? `URL: ${n.original_url}` : '',
            ];
            if (n.user_notes) lines.push(`User notes: ${n.user_notes}`);
            const ps = (picked.get(n.id) ?? []).sort((a, b) => a.chunk_index - b.chunk_index);
            if (ps.length) {
              for (const p of ps) lines.push(`> ${p.content}`);
            } else if (n.ai_summary) {
              lines.push(`Summary: ${n.ai_summary}`);
            } else if (n.source_description) {
              lines.push(`Description: ${n.source_description}`);
            }
            return lines.filter(Boolean).join('\n');
          })
          .join('\n\n---\n\n');
      } else {
        sourcesFragment = buildExcerptFragment();
      }
    } else {
      sourcesFragment = buildExcerptFragment();
    }
  }

  const isTailored = Boolean(workspace.system_prompt?.trim());
  const naturalNudge = isTailored
    ? ''
    : ' This collection has no custom voice configured, so write in a natural, human essay voice — like a sharp friend who read everything and has a point of view. Plain, specific, unhedged. Nothing that sounds like a research tool reporting on a database.';

  const thinNote = nodes.length < 3 ? ` ${THIN_NOTE}` : '';
  const userPrompt =
    prompt && prompt.trim()
      ? prompt.trim()
      : `${MODE_PROMPTS[mode]}${naturalNudge}${thinNote}`;

  const learningEnabled = workspace.learning_enabled === true;
  const learningTail = learningEnabled
    ? '\n\nThen, after the piece, output exactly this block and nothing after it:\n===LEARNING===\n<one standalone sentence, ≤200 chars: the most durable, reusable orientation about THIS body of work as a whole — its spine/through-line — that should guide future work in this Mind. Not a recap of the essay; a lasting claim. Cite the single most load-bearing source as [n].>'
    : '';

  const fullPrompt = [
    insightsFragment ? `${insightsFragment}\n\n---\n\n` : '',
    memoryFragment ? `${memoryFragment}\n\n---\n\n` : '',
    `The saved material${workspace.name ? ` ("${workspace.name}")` : ''}, numbered for citation:\n\n${sourcesFragment}`,
    '\n\n---\n\n',
    userPrompt,
    '\n\nFormat: begin the output with a single short Markdown H1 title line (3–8 words, specific, no quotes, no trailing punctuation), then a blank line, then the piece itself.',
    learningTail,
  ].join('');

  const provider = workspace.provider === 'gemini' ? 'gemini' : undefined;
  const model = workspace.model && workspace.model.trim() ? workspace.model : undefined;

  const rawOutput = await generateText({ prompt: fullPrompt, systemPrompt, provider, model });
  if (!rawOutput.trim()) {
    return { ok: false, status: 502, error: 'LLM returned an empty essay.' };
  }

  // Split off the piggybacked learning (no extra LLM call). The saved essay
  // never contains the delimiter or tail.
  let body_md = rawOutput;
  let learningText = '';
  if (learningEnabled) {
    const parts = rawOutput.split(/\n*={3,}\s*LEARNING\s*={0,}\n*/i);
    if (parts.length > 1) {
      body_md = parts[0].trim();
      learningText = parts.slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 240);
    }
  }
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
      trail: {
        kind: origin === 'digest' ? 'digest' : prompt ? 'custom-prompt' : mode,
        mode: prompt ? 'custom' : mode,
        origin: origin ?? 'manual',
        node_count: nodes.length,
        retrieval: retrievalUsed ? 'chunks' : 'excerpt',
      },
    })
    .select('id,workspace_id,title,body_md,source_node_ids,provider,model,trail,created_at')
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

  // Hermes-pattern: persist the distilled learning (piggybacked above — no
  // extra LLM call) as an insight, anchored to its cited source. Cap the
  // learned set per Mind so priming stays tight.
  if (learningEnabled && learningText) {
    const citeMatch = learningText.match(/\[(\d+)\]/);
    const citeIdx = citeMatch ? parseInt(citeMatch[1], 10) - 1 : -1;
    const sourceNodeId = citeIdx >= 0 && citeIdx < nodes.length ? nodes[citeIdx].id : null;
    const admin = getSupabaseAdmin();
    const { error: learnErr } = await admin.from('insights').insert({
      workspace_id: workspaceId,
      created_by: generatedBy,
      title: null,
      body: learningText,
      source_node_id: sourceNodeId,
      source_kind: 'learned',
    });
    if (!learnErr) {
      const { data: learned } = await admin
        .from('insights')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('source_kind', 'learned')
        .order('created_at', { ascending: false });
      const ids = (learned ?? []).map((r) => (r as { id: string }).id);
      if (ids.length > 30) {
        await admin.from('insights').delete().in('id', ids.slice(30));
      }
    }
  }

  return { ok: true, essay: essay as Essay };
}
