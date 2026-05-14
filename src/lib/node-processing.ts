import { aiProcess, embeddingProcess } from './llm';
import { getSupabaseAdmin } from './supabase';

type NodeProcessRow = {
  id: string;
  title: string | null;
  original_url: string | null;
  raw_text: string | null;
  source_description: string | null;
  source_author: string | null;
  user_notes: string | null;
};

export async function improveNodeSummary(nodeId: string, workspaceId: string) {
  const supabase = getSupabaseAdmin();
  const warnings: string[] = [];

  const { data: node, error: nodeError } = await supabase
    .from('nodes')
    .select('id,title,original_url,raw_text,source_description,source_author,user_notes')
    .eq('id', nodeId)
    .eq('workspace_id', workspaceId)
    .single();

  if (nodeError) throw new Error(nodeError.message);

  const { data: tagsData } = await supabase
    .from('tags')
    .select('shift_name')
    .eq('workspace_id', workspaceId);

  const { data: noteRows, error: notesError } = await supabase
    .from('node_notes')
    .select('body,created_at')
    .eq('node_id', nodeId)
    .order('created_at', { ascending: true });
  if (notesError) warnings.push(notesError.message);

  const typedNode = node as NodeProcessRow;
  const savedNotes = (noteRows ?? [])
    .map((note, index) => `${index + 1}. ${note.body}`)
    .join('\n');
  const sourceText = [
    `Title: ${typedNode.title ?? ''}`,
    `URL: ${typedNode.original_url ?? ''}`,
    `Author: ${typedNode.source_author ?? ''}`,
    `Metadata description: ${typedNode.source_description ?? ''}`,
    `Initial capture note: ${typedNode.user_notes ?? ''}`,
    `Saved notes:\n${savedNotes}`,
    `Text: ${typedNode.raw_text ?? ''}`,
  ]
    .join('\n')
    .trim();

  const ai = await aiProcess({
    text: sourceText,
    tags: (tagsData ?? []).map((tag) => tag.shift_name),
  }).catch((error) => {
    warnings.push(error instanceof Error ? error.message : 'AI processing failed.');
    return {
      summary:
        typedNode.source_description ||
        typedNode.user_notes ||
        typedNode.raw_text ||
        typedNode.title ||
        'Saved. MuttMind will add details when processing is available.',
      tags: [] as string[],
      embedding: [] as number[],
    };
  });

  const { error: summaryError } = await supabase.from('nodes').update({ ai_summary: ai.summary }).eq('id', nodeId);
  if (summaryError) warnings.push(summaryError.message);

  const embeddingText = [
    typedNode.title,
    typedNode.original_url,
    typedNode.source_description,
    typedNode.user_notes,
    savedNotes,
    typedNode.raw_text,
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
        const { error } = await supabase.from('nodes').update({ embedding }).eq('id', nodeId);
        if (error) warnings.push(error.message);
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Embedding failed.');
    }
  }

  if (ai.tags.length) {
    const { error: tagsError } = await supabase.from('tags').upsert(
      ai.tags.map((shiftName) => ({
        workspace_id: workspaceId,
        shift_name: shiftName,
      })),
      { onConflict: 'workspace_id,shift_name' },
    );
    if (tagsError) warnings.push(tagsError.message);

    const { data: tagRows, error: tagRowsError } = await supabase
      .from('tags')
      .select('id,shift_name')
      .eq('workspace_id', workspaceId)
      .in('shift_name', ai.tags);
    if (tagRowsError) warnings.push(tagRowsError.message);

    if (tagRows?.length) {
      const { error: nodeTagsError } = await supabase.from('node_tags').upsert(
        tagRows.map((tag) => ({ node_id: nodeId, tag_id: tag.id })),
        { onConflict: 'node_id,tag_id' },
      );
      if (nodeTagsError) warnings.push(nodeTagsError.message);
    }
  }

  return { summary: ai.summary, tags: ai.tags, warnings };
}
