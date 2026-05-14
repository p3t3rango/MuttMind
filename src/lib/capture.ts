import { aiProcess, embeddingProcess } from './llm';
import { scrapeUrl } from './scrape';
import { getSupabaseAdmin } from './supabase';
import { assertWorkspaceMember } from './workspace';

type CaptureInput = {
  userId: string;
  workspaceId: string;
  url?: string;
  rawText?: string;
};

export async function captureSignal({ userId, workspaceId, url, rawText }: CaptureInput) {
  if (!workspaceId || (!url && !rawText)) {
    throw new Error('workspaceId and url/rawText required');
  }

  await assertWorkspaceMember(workspaceId, userId);

  const scrape = url
    ? await scrapeUrl(url)
    : { title: '', description: '', image: '', author: '', text: '' };
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
  const sourceText = [
    `Title: ${node.title ?? ''}`,
    `URL: ${node.original_url ?? ''}`,
    `Author: ${node.source_author ?? ''}`,
    `Description: ${node.source_description ?? ''}`,
    `User notes: ${node.user_notes ?? ''}`,
    `Text: ${node.raw_text ?? ''}`,
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

  const embeddingText = [
    node.title,
    node.original_url,
    node.source_description,
    node.user_notes,
    node.raw_text,
    ai.summary,
    ai.tags.join(' '),
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

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

  return { nodeId: node.id, warnings };
}
