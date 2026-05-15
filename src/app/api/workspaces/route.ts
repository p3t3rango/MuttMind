import { requireUserId } from '@/lib/auth';
import { buildSkipPathPrompt } from '@/lib/minds-prompts';
import { userCan } from '@/lib/permissions';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertWorkspaceMember } from '@/lib/workspace';

type WorkspaceMemberRow = {
  role: string;
  workspaces: {
    id: string;
    name: string;
    markdown_content: string | null;
    system_prompt: string | null;
    voice_source: string;
    voice_user_ids: string[] | null;
    provider: string;
    model: string | null;
    created_at: string;
  };
};

type MemberCountRow = {
  workspace_id: string;
};

const VOICE_SOURCES = ['system_prompt', 'user_notes', 'mind_notes'] as const;
const WORKSPACE_SELECT = 'id,name,markdown_content,system_prompt,voice_source,voice_user_ids,provider,model,created_at';

function serializeWorkspace<T extends Record<string, unknown>>(row: T) {
  return {
    ...row,
    title: row.name,
  };
}

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { data, error } = await getSupabaseAdmin()
      .from('workspace_members')
      .select(`role, workspaces(${WORKSPACE_SELECT})`)
      .eq('user_id', userId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as unknown as WorkspaceMemberRow[];
    const workspaceIds = rows
      .map((item) => item.workspaces?.id)
      .filter((id: unknown): id is string => typeof id === 'string');
    const memberCounts = new Map<string, number>();

    if (workspaceIds.length) {
      const { data: members } = await getSupabaseAdmin()
        .from('workspace_members')
        .select('workspace_id')
        .in('workspace_id', workspaceIds);

      ((members ?? []) as unknown as MemberCountRow[]).forEach((member) => {
        memberCounts.set(member.workspace_id, (memberCounts.get(member.workspace_id) ?? 0) + 1);
      });
    }

    const workspaces = rows.map((item) => ({
      role: item.role,
      workspaces: {
        id: item.workspaces.id,
        title: item.workspaces.name,
        name: item.workspaces.name,
        markdown_content: item.workspaces.markdown_content,
        system_prompt: item.workspaces.system_prompt,
        voice_source: item.workspaces.voice_source,
        voice_user_ids: item.workspaces.voice_user_ids ?? [],
        provider: item.workspaces.provider,
        model: item.workspaces.model,
        created_at: item.workspaces.created_at,
        member_count: memberCounts.get(item.workspaces.id) ?? 1,
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

    // Optional Mind configuration from onboarding. If systemPrompt isn't given,
    // fall back to the skip-path prompt so the Mind always has a usable prompt.
    const trimmedSystemPrompt =
      typeof body?.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
    const systemPrompt = trimmedSystemPrompt || buildSkipPathPrompt(name);

    const voiceSource =
      typeof body?.voiceSource === 'string' && (VOICE_SOURCES as readonly string[]).includes(body.voiceSource)
        ? body.voiceSource
        : 'system_prompt';
    const voiceUserIds = Array.isArray(body?.voiceUserIds)
      ? body.voiceUserIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];

    const insertPayload: Record<string, unknown> = {
      name,
      created_by: userId,
      system_prompt: systemPrompt,
      voice_source: voiceSource,
      voice_user_ids: voiceUserIds,
    };
    if (typeof body?.provider === 'string' && body.provider.trim()) insertPayload.provider = body.provider.trim();
    if (typeof body?.model === 'string' && body.model.trim()) insertPayload.model = body.model.trim();

    const { data: workspace, error } = await getSupabaseAdmin()
      .from('workspaces')
      .insert(insertPayload)
      .select(WORKSPACE_SELECT)
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await getSupabaseAdmin()
      .from('workspace_members')
      .insert({ workspace_id: workspace.id, user_id: userId, role: 'owner' });
    return Response.json({ workspace: serializeWorkspace(workspace) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = await req.json();
    const { workspaceId, title, markdownContent } = body ?? {};
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    await assertWorkspaceMember(workspaceId, userId);

    const wantsMindEdit =
      'systemPrompt' in body ||
      'voiceSource' in body ||
      'voiceUserIds' in body ||
      'provider' in body ||
      'model' in body;
    if (wantsMindEdit) {
      const canManage = await userCan(userId, workspaceId, 'manage_mind');
      if (!canManage) return Response.json({ error: 'Not allowed to edit this Mind' }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    if (typeof title === 'string' && title.trim()) updates.name = title.trim();
    if (typeof markdownContent === 'string') updates.markdown_content = markdownContent;
    if (typeof body.systemPrompt === 'string') updates.system_prompt = body.systemPrompt;
    if (typeof body.voiceSource === 'string' && (VOICE_SOURCES as readonly string[]).includes(body.voiceSource))
      updates.voice_source = body.voiceSource;
    if (Array.isArray(body.voiceUserIds))
      updates.voice_user_ids = body.voiceUserIds.filter((id: unknown): id is string => typeof id === 'string');
    if (typeof body.provider === 'string' && body.provider.trim()) updates.provider = body.provider.trim();
    if (body.model === null) updates.model = null;
    else if (typeof body.model === 'string') updates.model = body.model.trim() || null;

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'No editable fields supplied' }, { status: 400 });
    }

    const { data, error } = await getSupabaseAdmin()
      .from('workspaces')
      .update(updates)
      .eq('id', workspaceId)
      .select(WORKSPACE_SELECT)
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ workspace: serializeWorkspace(data) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
