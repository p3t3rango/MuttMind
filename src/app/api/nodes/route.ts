import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const workspaceId = new URL(req.url).searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);
    const { data, error } = await getSupabaseAdmin()
      .from('nodes')
      .select('id,title,original_url,og_image_url,source_description,source_author,raw_text,ai_summary,node_tags(tags(shift_name))')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const nodes = (data ?? []).map((node: any) => ({
      id: node.id,
      title: node.title,
      original_url: node.original_url,
      og_image_url: node.og_image_url,
      source_description: node.source_description,
      source_author: node.source_author,
      raw_text: node.raw_text,
      ai_summary: node.ai_summary,
      tags: Array.isArray(node.node_tags)
        ? node.node_tags
            .map((item: any) => item?.tags?.shift_name)
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
