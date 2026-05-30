import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

type NodeTagRow = {
  tags?: { shift_name?: string | null } | null;
};

type NodeRow = {
  id: string;
  workspace_id: string;
  title: string | null;
  original_url: string | null;
  og_image_url: string | null;
  source_description: string | null;
  source_author: string | null;
  raw_text: string | null;
  user_notes: string | null;
  ai_summary: string | null;
  created_by: string | null;
  created_at: string;
  users?: { display_name?: string | null; email?: string | null } | null;
  node_tags?: NodeTagRow[] | null;
};

/**
 * GET /api/nodes/{nodeId}?workspaceId=X
 * Fetch a single capture. Used by deep links (e.g. opening a node from the
 * vault graph) where the capture may not be in the dashboard's recent slice.
 */
export async function GET(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const { data, error } = await getSupabaseAdmin()
      .from('nodes')
      .select(
        'id,workspace_id,title,original_url,og_image_url,source_description,source_author,raw_text,user_notes,ai_summary,created_by,created_at,users(display_name,email),node_tags(tags(shift_name))',
      )
      .eq('workspace_id', workspaceId)
      .eq('id', nodeId)
      .maybeSingle();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: 'Capture not found' }, { status: 404 });

    const node = data as unknown as NodeRow;
    return Response.json({
      node: {
        id: node.id,
        title: node.title,
        original_url: node.original_url,
        og_image_url: node.og_image_url,
        source_description: node.source_description,
        source_author: node.source_author,
        raw_text: node.raw_text,
        user_notes: node.user_notes,
        ai_summary: node.ai_summary,
        created_by: node.created_by,
        created_at: node.created_at,
        created_by_label: node.users?.display_name || node.users?.email || 'teammate',
        tags: Array.isArray(node.node_tags)
          ? node.node_tags
              .map((item) => item?.tags?.shift_name)
              .filter((tag: unknown): tag is string => typeof tag === 'string' && tag.length > 0)
          : [],
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { nodeId } = await context.params;
    const body = await req.json();
    const { workspaceId, publishedAt } = body ?? {};
    if (!workspaceId || !nodeId) {
      return Response.json({ error: 'workspaceId and nodeId required' }, { status: 400 });
    }
    await assertWorkspaceMember(workspaceId, userId);

    const updates: Record<string, unknown> = {};
    if (publishedAt === null) updates.published_at = null;
    else if (typeof publishedAt === 'string' && publishedAt.trim()) {
      const d = new Date(publishedAt);
      if (Number.isNaN(d.getTime())) {
        return Response.json({ error: 'publishedAt must be a valid ISO date or null' }, { status: 400 });
      }
      updates.published_at = d.toISOString();
    }

    if (!Object.keys(updates).length) return Response.json({ ok: true, unchanged: true });

    const { data, error } = await getSupabaseAdmin()
      .from('nodes')
      .update(updates)
      .eq('id', nodeId)
      .eq('workspace_id', workspaceId)
      .select('id,published_at')
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, node: data });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
