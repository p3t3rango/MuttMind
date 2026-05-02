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

  const { data: node, error: nodeError } = await getSupabaseAdmin()
    .from('nodes')
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      original_url: url,
      raw_text: rawText ?? scrape.text,
      content_type: url ? 'link' : 'text',
      title: scrape.title,
      og_image_url: scrape.image,
      source_description: scrape.description,
      source_author: scrape.author,
    })
    .select('id, title, original_url, raw_text, source_description, source_author')
    .single();

  if (nodeError) throw new Error(nodeError.message);

  const { data: tagsData } = await getSupabaseAdmin()
    .from('tags')
    .select('shift_name')
    .eq('workspace_id', workspaceId);

  const ai = await aiProcess({
    text: [
      `Title: ${node.title ?? ''}`,
      `URL: ${node.original_url ?? ''}`,
      `Author: ${node.source_author ?? ''}`,
      `Description: ${node.source_description ?? ''}`,
      `Text: ${node.raw_text ?? ''}`,
    ]
      .join('\n')
      .trim(),
    tags: (tagsData ?? []).map((tag) => tag.shift_name),
  });

  await getSupabaseAdmin().from('nodes').update({ ai_summary: ai.summary }).eq('id', node.id);

  const embeddingText = [
    node.title,
    node.original_url,
    node.source_description,
    node.raw_text,
    ai.summary,
    ai.tags.join(' '),
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

  if (embeddingText) {
    const embedding = await embeddingProcess({ text: embeddingText });
    if (embedding.length) {
      await getSupabaseAdmin().from('embeddings').upsert(
        { node_id: node.id, embedding },
        { onConflict: 'node_id' },
      );
    }
  }

  if (ai.tags.length) {
    await getSupabaseAdmin().from('tags').upsert(
      ai.tags.map((shiftName) => ({
        workspace_id: workspaceId,
        shift_name: shiftName,
      })),
      { onConflict: 'workspace_id,shift_name' },
    );

    const { data: tagRows } = await getSupabaseAdmin()
      .from('tags')
      .select('id,shift_name')
      .eq('workspace_id', workspaceId)
      .in('shift_name', ai.tags);

    if (tagRows?.length) {
      await getSupabaseAdmin().from('node_tags').upsert(
        tagRows.map((tag) => ({ node_id: node.id, tag_id: tag.id })),
        { onConflict: 'node_id,tag_id' },
      );
    }
  }

  return { nodeId: node.id };
}
