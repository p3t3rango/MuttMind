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
  workspace_id: string;
  title: string | null;
  original_url: string | null;
  og_image_url: string | null;
  source_description: string | null;
  source_author: string | null;
  raw_text: string | null;
  ai_summary: string | null;
  user_notes: string | null;
  scrape_kind: string | null;
  media_path: string | null;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
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

    const select =
      'id,workspace_id,title,original_url,og_image_url,source_description,source_author,raw_text,user_notes,ai_summary,scrape_kind,media_path,created_by,created_at,published_at,users(display_name,email),node_tags(tags(shift_name))';

    // Captures connected to this Mind from elsewhere (Feature 1.5).
    const { data: connections } = await getSupabaseAdmin()
      .from('node_workspaces')
      .select('node_id')
      .eq('workspace_id', workspaceId);
    const connectedIds = (connections ?? [])
      .map((c) => (c as { node_id: string }).node_id)
      .filter((id): id is string => typeof id === 'string');

    let queryBuilder = getSupabaseAdmin().from('nodes').select(select);
    queryBuilder = connectedIds.length
      ? queryBuilder.or(`workspace_id.eq.${workspaceId},id.in.(${connectedIds.join(',')})`)
      : queryBuilder.eq('workspace_id', workspaceId);

    const { data, error } = await queryBuilder
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return Response.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []) as unknown as NodeListRow[];
    const seen = new Set<string>();
    const nodes = rows
      .filter((node) => {
        if (seen.has(node.id)) return false;
        seen.add(node.id);
        return true;
      })
      .map((node) => ({
        id: node.id,
        title: node.title,
        original_url: node.original_url,
        og_image_url: node.og_image_url,
        source_description: node.source_description,
        source_author: node.source_author,
        raw_text: node.raw_text,
        user_notes: node.user_notes,
        ai_summary: node.ai_summary,
        scrape_kind: node.scrape_kind,
        media_path: node.media_path,
        media_url: null as string | null,
        created_by: node.created_by,
        published_at: node.published_at,
        created_by_label: node.users?.display_name || node.users?.email || 'teammate',
        // True when the capture's home is a different Mind — it's here via a
        // connection rather than originally saved here.
        connected: node.workspace_id !== workspaceId,
        tags: Array.isArray(node.node_tags)
          ? node.node_tags
              .map((item) => item?.tags?.shift_name)
              .filter((tag: unknown): tag is string => typeof tag === 'string' && tag.length > 0)
          : [],
      }));

    // Private-bucket images: mint short-lived signed URLs at read time so the
    // file is never publicly addressable. The list endpoint is already
    // workspace-member gated.
    const withMedia = nodes.filter((n) => n.media_path);
    if (withMedia.length) {
      const { data: signed } = await getSupabaseAdmin()
        .storage.from('captures')
        .createSignedUrls(
          withMedia.map((n) => n.media_path as string),
          3600,
        );
      const byPath = new Map(
        (signed ?? []).map((s) => [s.path ?? '', s.signedUrl] as const),
      );
      for (const n of nodes) {
        if (n.media_path) {
          const url = byPath.get(n.media_path);
          if (url) {
            n.media_url = url;
            // Images render via og_image_url; audio uses media_url directly.
            if (n.scrape_kind === 'image') n.og_image_url = url;
          }
        }
      }
    }
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
