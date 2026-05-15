import { requireUserId } from '@/lib/auth';
import { userCan } from '@/lib/permissions';
import { buildSkipPathPrompt } from '@/lib/spaces-prompts';
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
  system_prompt: string | null;
  voice_source: string;
  voice_user_ids: string[] | null;
  mode_type: string;
  seed_node_id: string | null;
  seed_tag_id: string | null;
  seed_author: string | null;
  provider: string;
  model: string | null;
  users?: {
    display_name?: string | null;
    email?: string | null;
  } | null;
};

const SELECT_COLUMNS =
  'id,name,query,color,workspace_id,created_at,created_by,system_prompt,voice_source,voice_user_ids,mode_type,seed_node_id,seed_tag_id,seed_author,provider,model,users(display_name,email)';

const VOICE_SOURCES = ['system_prompt', 'user_notes', 'mind_notes'] as const;
const MODE_TYPES = ['query', 'steep', 'voice', 'neighborhood', 'all'] as const;

function serializeSpace(space: SmartSpaceRow) {
  return {
    id: space.id,
    name: space.name,
    query: space.query,
    color: space.color,
    workspaceId: space.workspace_id,
    createdAt: space.created_at,
    createdBy: space.created_by,
    createdByLabel: space.users?.display_name || space.users?.email || 'teammate',
    systemPrompt: space.system_prompt,
    voiceSource: space.voice_source,
    voiceUserIds: space.voice_user_ids ?? [],
    modeType: space.mode_type,
    seedNodeId: space.seed_node_id,
    seedTagId: space.seed_tag_id,
    seedAuthor: space.seed_author,
    provider: space.provider,
    model: space.model,
  };
}

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const workspaceId = new URL(req.url).searchParams.get('workspaceId');
    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });

    await assertWorkspaceMember(workspaceId, userId);
    const { data, error } = await getSupabaseAdmin()
      .from('smart_spaces')
      .select(SELECT_COLUMNS)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) return Response.json({ error: error.message }, { status: 500 });

    const spaces = ((data ?? []) as unknown as SmartSpaceRow[]).map(serializeSpace);
    return Response.json({ spaces });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = await req.json();
    const { workspaceId, name, query, color } = body ?? {};
    if (!workspaceId || !name) {
      return Response.json({ error: 'workspaceId and name required' }, { status: 400 });
    }
    const queryValue = typeof query === 'string' ? query.trim() : '';

    await assertWorkspaceMember(workspaceId, userId);

    // Optional configuration fields. system_prompt may be:
    //   - explicit text from the onboarding flow
    //   - explicit text from a saved draft
    //   - undefined: caller did not set one. Use the skip-path default so the Space
    //     always has a workable prompt rather than silently inheriting null.
    const trimmedSystemPrompt =
      typeof body?.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
    const systemPrompt = trimmedSystemPrompt || buildSkipPathPrompt(String(name).trim());

    const voiceSource =
      typeof body?.voiceSource === 'string' && (VOICE_SOURCES as readonly string[]).includes(body.voiceSource)
        ? body.voiceSource
        : 'system_prompt';

    const voiceUserIds = Array.isArray(body?.voiceUserIds)
      ? body.voiceUserIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];

    const modeType =
      typeof body?.modeType === 'string' && (MODE_TYPES as readonly string[]).includes(body.modeType)
        ? body.modeType
        : 'query';

    const insertPayload: Record<string, unknown> = {
      workspace_id: workspaceId,
      created_by: userId,
      name: String(name).trim(),
      query: queryValue,
      color: typeof color === 'string' && color.trim() ? color.trim() : '#7c3aed',
      system_prompt: systemPrompt,
      voice_source: voiceSource,
      voice_user_ids: voiceUserIds,
      mode_type: modeType,
    };

    if (typeof body?.seedNodeId === 'string' && body.seedNodeId.length) insertPayload.seed_node_id = body.seedNodeId;
    if (typeof body?.seedTagId === 'string' && body.seedTagId.length) insertPayload.seed_tag_id = body.seedTagId;
    if (typeof body?.seedAuthor === 'string' && body.seedAuthor.trim()) insertPayload.seed_author = body.seedAuthor.trim();
    if (typeof body?.provider === 'string' && body.provider.trim()) insertPayload.provider = body.provider.trim();
    if (typeof body?.model === 'string' && body.model.trim()) insertPayload.model = body.model.trim();

    const { data, error } = await getSupabaseAdmin()
      .from('smart_spaces')
      .insert(insertPayload)
      .select(SELECT_COLUMNS)
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ space: serializeSpace(data as unknown as SmartSpaceRow) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = await req.json();
    const { workspaceId, spaceId } = body ?? {};
    if (!workspaceId || !spaceId) {
      return Response.json({ error: 'workspaceId and spaceId required' }, { status: 400 });
    }

    await assertWorkspaceMember(workspaceId, userId);

    // Permission: explicit manage_spaces grant OR the Space's creator.
    const { data: existing, error: existingError } = await getSupabaseAdmin()
      .from('smart_spaces')
      .select('id,created_by')
      .eq('workspace_id', workspaceId)
      .eq('id', spaceId)
      .maybeSingle();

    if (existingError) return Response.json({ error: existingError.message }, { status: 500 });
    if (!existing) return Response.json({ error: 'Space not found' }, { status: 404 });

    const isCreator = existing.created_by === userId;
    const canManage = await userCan(userId, workspaceId, 'manage_spaces');
    if (!isCreator && !canManage) {
      return Response.json({ error: 'Not allowed to edit this Space' }, { status: 403 });
    }

    const updatePayload: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) updatePayload.name = body.name.trim();
    if (typeof body.query === 'string') updatePayload.query = body.query.trim();
    if (typeof body.color === 'string' && body.color.trim()) updatePayload.color = body.color.trim();
    if (typeof body.systemPrompt === 'string') updatePayload.system_prompt = body.systemPrompt;
    if (typeof body.voiceSource === 'string' && (VOICE_SOURCES as readonly string[]).includes(body.voiceSource))
      updatePayload.voice_source = body.voiceSource;
    if (Array.isArray(body.voiceUserIds))
      updatePayload.voice_user_ids = body.voiceUserIds.filter((id: unknown): id is string => typeof id === 'string');
    if (typeof body.modeType === 'string' && (MODE_TYPES as readonly string[]).includes(body.modeType))
      updatePayload.mode_type = body.modeType;
    if (body.seedNodeId === null) updatePayload.seed_node_id = null;
    else if (typeof body.seedNodeId === 'string' && body.seedNodeId.length) updatePayload.seed_node_id = body.seedNodeId;
    if (body.seedTagId === null) updatePayload.seed_tag_id = null;
    else if (typeof body.seedTagId === 'string' && body.seedTagId.length) updatePayload.seed_tag_id = body.seedTagId;
    if (body.seedAuthor === null) updatePayload.seed_author = null;
    else if (typeof body.seedAuthor === 'string') updatePayload.seed_author = body.seedAuthor.trim() || null;
    if (typeof body.provider === 'string' && body.provider.trim()) updatePayload.provider = body.provider.trim();
    if (body.model === null) updatePayload.model = null;
    else if (typeof body.model === 'string') updatePayload.model = body.model.trim() || null;

    if (Object.keys(updatePayload).length === 0) {
      return Response.json({ error: 'No editable fields supplied' }, { status: 400 });
    }

    const { data, error } = await getSupabaseAdmin()
      .from('smart_spaces')
      .update(updatePayload)
      .eq('workspace_id', workspaceId)
      .eq('id', spaceId)
      .select(SELECT_COLUMNS)
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ space: serializeSpace(data as unknown as SmartSpaceRow) });
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
    if (!['owner', 'admin'].includes(role)) {
      const canManage = await userCan(userId, workspaceId, 'manage_spaces');
      if (!canManage) query = query.eq('created_by', userId);
    }

    const { error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
