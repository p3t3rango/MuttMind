import { chunkText } from './chunk';
import { buildEmbeddingInput } from './embedding-input';
import { env } from './env';
import { aiProcess, embeddingProcess } from './llm';
import { scrapeUrl } from './scrape';
import { getSupabaseAdmin } from './supabase';
import { assertWorkspaceMember } from './workspace';

type Prefetched = {
  kind: string;
  title?: string;
  text?: string;
  image?: string;
  description?: string;
  author?: string;
};

type CaptureInput = {
  userId: string;
  workspaceId: string;
  url?: string;
  rawText?: string;
  /** Supplied by upload/voice paths: content already extracted, skip scrapeUrl. */
  prefetched?: Prefetched;
};

export async function captureSignal({
  userId,
  workspaceId,
  url,
  rawText,
  prefetched,
}: CaptureInput) {
  if (!workspaceId || (!url && !rawText && !prefetched)) {
    throw new Error('workspaceId and url/rawText/prefetched required');
  }

  await assertWorkspaceMember(workspaceId, userId);

  const scrape = url
    ? await scrapeUrl(url)
    : prefetched
      ? {
          title: prefetched.title ?? '',
          description: prefetched.description ?? '',
          image: prefetched.image ?? '',
          author: prefetched.author ?? '',
          text: prefetched.text ?? '',
          kind: prefetched.kind,
          truncated: false,
          extractionWarnings: [] as string[],
        }
      : {
          title: '',
          description: '',
          image: '',
          author: '',
          text: '',
          kind: 'note' as const,
          truncated: false,
          extractionWarnings: [] as string[],
        };
  const normalizedRawText = rawText?.trim() ?? '';
  const normalizedUrl = url?.trim() ?? '';
  const userNote = normalizedRawText && normalizedRawText !== normalizedUrl ? normalizedRawText : '';
  const capturedText = url
    ? [userNote ? `User note: ${userNote}` : '', scrape.text].filter(Boolean).join('\n\n').trim()
    : normalizedRawText;

  const { data: node, error: nodeError } = await getSupabaseAdmin()
    .from('nodes')
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      original_url: url,
      raw_text: capturedText || normalizedRawText || scrape.text,
      content_type: url ? 'link' : 'text',
      scrape_kind: scrape.kind,
      title: scrape.title,
      og_image_url: scrape.image,
      source_description: scrape.description,
      source_author: scrape.author,
      user_notes: userNote || null,
    })
    .select('id, title, original_url, raw_text, source_description, source_author, user_notes')
    .single();

  if (nodeError) throw new Error(nodeError.message);

  const { data: tagsData } = await getSupabaseAdmin()
    .from('tags')
    .select('shift_name')
    .eq('workspace_id', workspaceId);

  const warnings: string[] = [];
  // raw_text can now be a full article/PDF. The summary doesn't need the whole
  // body to be good, and Gemini cost scales with input — cap what we feed it.
  const SUMMARY_TEXT_CAP = 24_000;
  const rawForSummary = (node.raw_text ?? '').slice(0, SUMMARY_TEXT_CAP);
  const sourceText = [
    `Title: ${node.title ?? ''}`,
    `URL: ${node.original_url ?? ''}`,
    `Author: ${node.source_author ?? ''}`,
    `Description: ${node.source_description ?? ''}`,
    `User notes: ${node.user_notes ?? ''}`,
    `Text: ${rawForSummary}`,
  ]
    .join('\n')
    .trim();

  const ai = await aiProcess({
    text: sourceText,
    tags: (tagsData ?? []).map((tag) => tag.shift_name),
  }).catch((error) => {
    warnings.push(error instanceof Error ? error.message : 'AI processing failed.');
    return {
      summary: node.source_description || node.raw_text || node.title || 'Saved. MuttMind will add details when processing is available.',
      tags: [] as string[],
      embedding: [] as number[],
    };
  });

  const { error: summaryError } = await getSupabaseAdmin().from('nodes').update({ ai_summary: ai.summary }).eq('id', node.id);
  if (summaryError) warnings.push(summaryError.message);

  const embeddingText = buildEmbeddingInput(
    [
      node.title,
      node.original_url,
      node.source_description,
      node.user_notes,
      ai.summary,
      ai.tags.join(' '),
    ],
    node.raw_text,
  );

  if (embeddingText) {
    try {
      const embedding = await embeddingProcess({ text: embeddingText });
      if (embedding.length) {
        const { error } = await getSupabaseAdmin().from('nodes').update({ embedding }).eq('id', node.id);
        if (error) warnings.push(error.message);
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Embedding failed.');
    }
  }

  if (ai.tags.length) {
    const { error: tagsError } = await getSupabaseAdmin().from('tags').upsert(
      ai.tags.map((shiftName) => ({
        workspace_id: workspaceId,
        shift_name: shiftName,
      })),
      { onConflict: 'workspace_id,shift_name' },
    );
    if (tagsError) warnings.push(tagsError.message);

    const { data: tagRows, error: tagRowsError } = await getSupabaseAdmin()
      .from('tags')
      .select('id,shift_name')
      .eq('workspace_id', workspaceId)
      .in('shift_name', ai.tags);
    if (tagRowsError) warnings.push(tagRowsError.message);

    if (tagRows?.length) {
      const { error: nodeTagsError } = await getSupabaseAdmin().from('node_tags').upsert(
        tagRows.map((tag) => ({ node_id: node.id, tag_id: tag.id })),
        { onConflict: 'node_id,tag_id' },
      );
      if (nodeTagsError) warnings.push(nodeTagsError.message);
    }
  }

  // Stage 2: per-passage embeddings. Gated so the extra N embed calls/capture
  // only happen deliberately. Never fails the capture — chunks are additive;
  // node-level embedding above is the always-available fallback.
  if (env.chunkingEnabled) {
    try {
      const chunks = chunkText(node.raw_text ?? '');
      if (chunks.length) {
        const CONCURRENCY = 3;
        const rows: {
          node_id: string;
          workspace_id: string;
          chunk_index: number;
          content: string;
          token_estimate: number;
          embedding: number[];
        }[] = [];
        for (let i = 0; i < chunks.length; i += CONCURRENCY) {
          const batch = chunks.slice(i, i + CONCURRENCY);
          const embedded = await Promise.all(
            batch.map(async (c) => {
              try {
                const embedding = await embeddingProcess({ text: c.content });
                return embedding.length ? { c, embedding } : null;
              } catch {
                return null;
              }
            }),
          );
          for (const r of embedded) {
            if (!r) continue;
            rows.push({
              node_id: node.id,
              workspace_id: workspaceId,
              chunk_index: r.c.index,
              content: r.c.content,
              token_estimate: r.c.tokenEstimate,
              embedding: r.embedding,
            });
          }
        }
        if (rows.length) {
          const { error: chunkError } = await getSupabaseAdmin()
            .from('node_chunks')
            .upsert(rows, { onConflict: 'node_id,chunk_index' });
          if (chunkError) warnings.push(chunkError.message);
        }
        if (rows.length < chunks.length) {
          warnings.push(`Chunking: embedded ${rows.length}/${chunks.length} passages.`);
        }
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Chunking failed.');
    }
  }

  return { nodeId: node.id, warnings };
}
