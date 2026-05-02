import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { data, error } = await getSupabaseAdmin()
      .from('workspace_members')
      .select('role, workspaces(id, name, markdown_content, created_at)')
      .eq('user_id', userId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const workspaces = (data ?? []).map((item: any) => ({
      role: item.role,
      workspaces: {
        id: item.workspaces.id,
        title: item.workspaces.name,
        name: item.workspaces.name,
        markdown_content: item.workspaces.markdown_content,
        created_at: item.workspaces.created_at,
      },
    }));
    return Response.json({ workspaces });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = await req.json();
    const name = String(body.name ?? body.title ?? '').trim();
    if (!name) return Response.json({ error: 'name required' }, { status: 400 });
    const { data: workspace, error } = await getSupabaseAdmin()
      .from('workspaces')
      .insert({ name, created_by: userId })
      .select('id,name,markdown_content,created_at')
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await getSupabaseAdmin().from('workspace_members').insert({ workspace_id: workspace.id, user_id: userId, role: 'owner' });
    return Response.json({ workspace: { ...workspace, title: workspace.name } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { workspaceId, title, markdownContent } = await req.json();
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);
    const updates: Record<string, string | null> = {};
    if (typeof title === 'string' && title.trim()) updates.name = title.trim();
    if (typeof markdownContent === 'string') updates.markdown_content = markdownContent;

    const { data, error } = await getSupabaseAdmin()
      .from('workspaces')
      .update(updates)
      .eq('id', workspaceId)
      .select('id,name,markdown_content,created_at')
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ workspace: { ...data, title: data.name } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
