import JSZip from 'jszip';
import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

export const runtime = 'nodejs';

type ExportNode = {
  id: string;
  title: string | null;
  original_url: string | null;
  raw_text: string | null;
  source_description: string | null;
  source_author: string | null;
  ai_summary: string | null;
  created_at: string;
  tags: string[];
};

type NodeTagRow = {
  tags?: {
    shift_name?: string | null;
  } | null;
};

type ExportNodeRow = Omit<ExportNode, 'tags'> & {
  node_tags?: NodeTagRow[] | null;
};

type EmbeddingRow = {
  node_id: string;
  embedding: unknown;
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'note';
}

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
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

function frontmatter(node: ExportNode) {
  return [
    '---',
    `title: ${JSON.stringify(node.title ?? 'Untitled')}`,
    `original_url: ${JSON.stringify(node.original_url ?? '')}`,
    `captured_at: ${JSON.stringify(node.created_at)}`,
    `source_author: ${JSON.stringify(node.source_author ?? '')}`,
    `tags: [${node.tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
    '---',
    '',
  ].join('\n');
}

function body(node: ExportNode, relatedTitles: string[]) {
  const sections = [
    `# ${node.title ?? 'Untitled'}`,
    '',
    node.original_url ? `Source: ${node.original_url}` : '',
    node.source_description ? `Description: ${node.source_description}` : '',
    node.source_author ? `Author: ${node.source_author}` : '',
    node.ai_summary ? `Summary: ${node.ai_summary}` : '',
    '',
    node.raw_text ? node.raw_text : '',
    '',
    relatedTitles.length ? `Related: ${relatedTitles.map((title) => `[[${title}]]`).join(', ')}` : '',
  ].filter(Boolean);
  return sections.join('\n');
}

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const { data: nodesData, error: nodesError } = await getSupabaseAdmin()
      .from('nodes')
      .select('id,title,original_url,raw_text,source_description,source_author,ai_summary,created_at,node_tags(tags(shift_name))')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });

    if (nodesError) return Response.json({ error: nodesError.message }, { status: 500 });

    const nodes = ((nodesData ?? []) as unknown as ExportNodeRow[]).map((node) => ({
      id: node.id,
      title: node.title,
      original_url: node.original_url,
      raw_text: node.raw_text,
      source_description: node.source_description,
      source_author: node.source_author,
      ai_summary: node.ai_summary,
      created_at: node.created_at,
      tags: Array.isArray(node.node_tags)
        ? node.node_tags
            .map((item) => item?.tags?.shift_name)
            .filter((tag: unknown): tag is string => typeof tag === 'string' && tag.length > 0)
        : [],
    })) as ExportNode[];

    const nodeIds = nodes.map((node) => node.id);
    const embeddingMap = new Map<string, number[]>();
    if (nodeIds.length) {
      const { data: embeddingsData, error: embeddingsError } = await getSupabaseAdmin()
        .from('embeddings')
        .select('node_id,embedding')
        .in('node_id', nodeIds);
      if (embeddingsError) return Response.json({ error: embeddingsError.message }, { status: 500 });
      ((embeddingsData ?? []) as unknown as EmbeddingRow[]).forEach((row) => {
        embeddingMap.set(
          row.node_id,
          Array.isArray(row.embedding)
            ? row.embedding.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value))
            : [],
        );
      });
    }

    const relatedById = new Map<string, string[]>();
    nodes.forEach((node) => relatedById.set(node.id, []));

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const left = nodes[i];
        const right = nodes[j];
        const sharedTags = left.tags.filter((tag) => right.tags.includes(tag));
        const leftEmbedding = embeddingMap.get(left.id) ?? [];
        const rightEmbedding = embeddingMap.get(right.id) ?? [];
        const similarity = cosineSimilarity(leftEmbedding, rightEmbedding);

        if (sharedTags.length > 0 || similarity >= 0.82) {
          relatedById.get(left.id)?.push(right.id);
          relatedById.get(right.id)?.push(left.id);
        }
      }
    }

    const zip = new JSZip();
    const folder = zip.folder(`muttmind-${slugify(workspaceId)}`);
    if (!folder) return Response.json({ error: 'Unable to create archive' }, { status: 500 });

    folder.file(
      'README.md',
      [
        '# MuttMind export',
        '',
        `Workspace: ${workspaceId}`,
        `Nodes: ${nodes.length}`,
        '',
        'This export uses Obsidian-style markdown links and frontmatter.',
      ].join('\n'),
    );

    nodes.forEach((node) => {
      const safeTitle = slugify(node.title ?? node.original_url ?? node.id);
      const relatedIds = relatedById.get(node.id) ?? [];
      const relatedTitles = relatedIds
        .slice(0, 5)
        .map((id) => nodes.find((candidate) => candidate.id === id)?.title)
        .filter((title): title is string => Boolean(title));

      folder.file(
        `nodes/${safeTitle}.md`,
        `${frontmatter(node)}${body(node, relatedTitles)}`,
      );
    });

    const tags = Array.from(new Set(nodes.flatMap((node) => node.tags))).sort();
    folder.file(
      'tags.md',
      [
        '# Tags',
        '',
        ...tags.map((tag) => `- ${tag}`),
      ].join('\n'),
    );

    const content = await zip.generateAsync({ type: 'uint8array' });
    return new Response(content as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="muttmind-${slugify(workspaceId)}.zip"`,
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
