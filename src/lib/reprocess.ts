import { chunkText } from './chunk';
import { buildEmbeddingInput } from './embedding-input';
import { aiProcess, embeddingProcess } from './llm';
import { scrapeUrl } from './scrape';
import { getSupabaseAdmin } from './supabase';

type Row = {
  id: string;
  original_url: string | null;
  content_type: string | null;
  raw_text: string | null;
  user_notes: string | null;
  title: string | null;
  source_description: string | null;
  source_author: string | null;
};

/**
 * In-place reprocess of an existing node with the current pipeline:
 * re-scrape (Stage 1B faithful extraction) → regenerate summary/tags →
 * re-embed → re-chunk (Stage 2). Updates the existing row — no new node, no
 * duplicates. Safe: a failed/empty re-scrape will not overwrite good raw_text.
 */
export async function reprocessNode(nodeId: string, workspaceId: string) {
  const supabase = getSupabaseAdmin();
  const warnings: string[] = [];

  const { data: nodeData, error: nodeError } = await supabase
    .from('nodes')
    .select('id,original_url,content_type,raw_text,user_notes,title,source_description,source_author')
    .eq('id', nodeId)
    .eq('workspace_id', workspaceId)
    .single();
  if (nodeError) throw new Error(nodeError.message);
  const node = nodeData as Row;

  let rawText = node.raw_text ?? '';
  let title = node.title ?? '';
  let sourceDescription = node.source_description ?? '';
  let sourceAuthor = node.source_author ?? '';
  let ogImage = '';

  if (node.original_url && node.content_type === 'link') {
    const scrape = await scrapeUrl(node.original_url);
    if (scrape.extractionWarnings.length) {
      warnings.push(`scrape: ${scrape.extractionWarnings.join('; ')}`);
    }
    const userNote = node.user_notes ?? '';
    const captured = [userNote ? `User note: ${userNote}` : '', scrape.text]
      .filter(Boolean)
      .join('\n\n')
      .trim();
    // Don't regress: only replace raw_text if the new extraction has real content.
    if (captured.length >= 40 || captured.length >= rawText.length) {
      rawText = captured || rawText;
    } else {
      warnings.push('Re-scrape returned little; kept existing raw_text.');
    }
    title = scrape.title || title;
    sourceDescription = scrape.description || sourceDescription;
    sourceAuthor = scrape.author || sourceAuthor;
    ogImage = scrape.image || '';

    const update: Record<string, string> = {
      raw_text: rawText,
      title,
      source_description: sourceDescription,
      source_author: sourceAuthor,
      scrape_kind: scrape.kind,
    };
    if (ogImage) update.og_image_url = ogImage;
    const { error: upErr } = await supabase.from('nodes').update(update).eq('id', nodeId);
    if (upErr) warnings.push(upErr.message);
  }

  const { data: tagsData } = await supabase
    .from('tags')
    .select('shift_name')
    .eq('workspace_id', workspaceId);

  const sourceText = [
    `Title: ${title}`,
    `URL: ${node.original_url ?? ''}`,
    `Author: ${sourceAuthor}`,
    `Description: ${sourceDescription}`,
    `User notes: ${node.user_notes ?? ''}`,
    `Text: ${rawText.slice(0, 24_000)}`,
  ]
    .join('\n')
    .trim();

  const ai = await aiProcess({
    text: sourceText,
    tags: (tagsData ?? []).map((t) => t.shift_name),
  }).catch((e) => {
    warnings.push(e instanceof Error ? e.message : 'AI processing failed.');
    return { summary: sourceDescription || rawText || title || 'Saved.', tags: [] as string[], embedding: [] as number[] };
  });

  const { error: sErr } = await supabase.from('nodes').update({ ai_summary: ai.summary }).eq('id', nodeId);
  if (sErr) warnings.push(sErr.message);

  const embeddingText = buildEmbeddingInput(
    [title, node.original_url, sourceDescription, node.user_notes, ai.summary, ai.tags.join(' ')],
    rawText,
  );
  if (embeddingText) {
    try {
      const embedding = await embeddingProcess({ text: embeddingText });
      if (embedding.length) {
        const { error } = await supabase.from('nodes').update({ embedding }).eq('id', nodeId);
        if (error) warnings.push(error.message);
      }
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : 'Embedding failed.');
    }
  }

  if (ai.tags.length) {
    await supabase
      .from('tags')
      .upsert(
        ai.tags.map((shift_name) => ({ workspace_id: workspaceId, shift_name })),
        { onConflict: 'workspace_id,shift_name' },
      );
    const { data: tagRows } = await supabase
      .from('tags')
      .select('id,shift_name')
      .eq('workspace_id', workspaceId)
      .in('shift_name', ai.tags);
    if (tagRows?.length) {
      await supabase
        .from('node_tags')
        .upsert(
          tagRows.map((t) => ({ node_id: nodeId, tag_id: t.id })),
          { onConflict: 'node_id,tag_id' },
        );
    }
  }

  // Rebuild chunks from scratch so a now-shorter doc can't leave stale
  // high-index passages behind.
  let chunkCount = 0;
  const chunks = chunkText(rawText);
  await supabase.from('node_chunks').delete().eq('node_id', nodeId);
  if (chunks.length) {
    const rows: {
      node_id: string;
      workspace_id: string;
      chunk_index: number;
      content: string;
      token_estimate: number;
      embedding: number[];
    }[] = [];
    const CONCURRENCY = 3;
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
          node_id: nodeId,
          workspace_id: workspaceId,
          chunk_index: r.c.index,
          content: r.c.content,
          token_estimate: r.c.tokenEstimate,
          embedding: r.embedding,
        });
      }
    }
    if (rows.length) {
      const { error: cErr } = await supabase.from('node_chunks').insert(rows);
      if (cErr) warnings.push(cErr.message);
      else chunkCount = rows.length;
    }
    if (rows.length < chunks.length) {
      warnings.push(`chunks: embedded ${rows.length}/${chunks.length}`);
    }
  }

  return { nodeId, title, rawLen: rawText.length, chunkCount, summary: ai.summary, warnings };
}
