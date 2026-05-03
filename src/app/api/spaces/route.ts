import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

type SmartSpaceRow = {
  id: string;
  name: string;
  query: string;
  color: string;
  workspace_id: string;
  created_at: string;
  created_by: string;
  users?: {
    display_name?: string | null;
    email?: string | null;
  } | null;
};

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const workspaceId = new URL(req.url).searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });

    await assertWorkspaceMember(workspaceId, userId);
    const { data, error } = await getSupabaseAdmin()
      .from('smart_spaces')
      .select('id,name,query,color,workspace_id,created_at,created_by,users(display_name,email)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) return Response.json({ error: error.message }, { status: 500 });

    const spaces = ((data ?? []) as unknown as SmartSpaceRow[]).map((space) => ({
      id: space.id,
      name: space.name,
      query: space.query,
      color: space.color,
      workspaceId: space.workspace_id,
      createdAt: space.created_at,
      createdBy: space.created_by,
      createdByLabel: space.users?.display_name || space.users?.email || 'teammate',
    }));

    return Response.json({ spaces });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, name, query, color } = await req.json();
    if (!workspaceId || !name || !query) {
      return Response.json({ error: 'workspaceId, name, and query required' }, { status: 400 });
    }

    await assertWorkspaceMember(workspaceId, userId);
    const { data, error } = await getSupabaseAdmin()
      .from('smart_spaces')
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        name: String(name).trim(),
        query: String(query).trim(),
        color: typeof color === 'string' && color.trim() ? color.trim() : '#7c3aed',
      })
      .select('id,name,query,color,workspace_id,created_at,created_by')
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({
      space: {
        id: data.id,
        name: data.name,
        query: data.query,
        color: data.color,
        workspaceId: data.workspace_id,
        createdAt: data.created_at,
        createdBy: data.created_by,
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    const spaceId = url.searchParams.get('spaceId');
    if (!workspaceId || !spaceId) return Response.json({ error: 'workspaceId and spaceId required' }, { status: 400 });

    const role = await assertWorkspaceMember(workspaceId, userId);
    let query = getSupabaseAdmin().from('smart_spaces').delete().eq('workspace_id', workspaceId).eq('id', spaceId);
    if (!['owner', 'admin'].includes(role)) query = query.eq('created_by', userId);

    const { error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
