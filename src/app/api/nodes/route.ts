import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

type NodeTagRow = {
  tags?: {
    shift_name?: string | null;
  } | null;
};

type NodeListRow = {
  id: string;
  title: string | null;
  original_url: string | null;
  og_image_url: string | null;
  source_description: string | null;
  source_author: string | null;
  raw_text: string | null;
  ai_summary: string | null;
  created_by: string | null;
  users?: {
    display_name?: string | null;
    email?: string | null;
  } | null;
  node_tags?: NodeTagRow[] | null;
};

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const workspaceId = new URL(req.url).searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);
    const { data, error } = await getSupabaseAdmin()
      .from('nodes')
      .select('id,title,original_url,og_image_url,source_description,source_author,raw_text,ai_summary,created_by,users(display_name,email),node_tags(tags(shift_name))')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as unknown as NodeListRow[];
    const nodes = rows.map((node) => ({
      id: node.id,
      title: node.title,
      original_url: node.original_url,
      og_image_url: node.og_image_url,
      source_description: node.source_description,
      source_author: node.source_author,
      raw_text: node.raw_text,
      ai_summary: node.ai_summary,
      created_by: node.created_by,
      created_by_label: node.users?.display_name || node.users?.email || 'teammate',
      tags: Array.isArray(node.node_tags)
        ? node.node_tags
            .map((item) => item?.tags?.shift_name)
            .filter((tag: unknown): tag is string => typeof tag === 'string' && tag.length > 0)
        : [],
    }));
    return Response.json({ nodes });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    const nodeId = url.searchParams.get('nodeId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const query = getSupabaseAdmin().from('nodes').delete().eq('workspace_id', workspaceId);
    const { error } = nodeId ? await query.eq('id', nodeId) : await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
