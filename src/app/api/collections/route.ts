import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import type { Collection, CollectionView, CollectionStatus } from '@/lib/collections';

interface Row {
  id: string;
  owner_user_id: string;
  title: string;
  description: string | null;
  cover_path: string | null;
  default_view: string;
  enabled_views: string[];
  show_summary: boolean;
  show_tags: boolean;
  show_notes: boolean;
  status: string;
  share_code: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT =
  'id, owner_user_id, title, description, cover_path, default_view, enabled_views, show_summary, show_tags, show_notes, status, share_code, created_at, updated_at';

function toCollection(r: Row): Collection {
  return {
    id: r.id,
    ownerUserId: r.owner_user_id,
    title: r.title,
    description: r.description,
    coverPath: r.cover_path,
    defaultView: r.default_view as CollectionView,
    enabledViews: r.enabled_views as CollectionView[],
    showSummary: r.show_summary,
    showTags: r.show_tags,
    showNotes: r.show_notes,
    status: r.status as CollectionStatus,
    shareCode: r.share_code,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const admin = getSupabaseAdmin();

    const { data: owned, error: ownedErr } = await admin
      .from('collections')
      .select(SELECT)
      .eq('owner_user_id', userId)
      .order('updated_at', { ascending: false });
    if (ownedErr) throw new Error(ownedErr.message);

    const { data: invitedRows, error: invErr } = await admin
      .from('collection_members')
      .select('collection_id')
      .eq('user_id', userId);
    if (invErr) throw new Error(invErr.message);

    const invitedIds = (invitedRows ?? []).map((r) => r.collection_id as string);

    let invited: Row[] = [];
    if (invitedIds.length) {
      const { data, error } = await admin
        .from('collections')
        .select(SELECT)
        .in('id', invitedIds)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      invited = (data ?? []) as Row[];
    }

    return Response.json({
      owned: ((owned ?? []) as Row[]).map(toCollection),
      invited: invited.map(toCollection),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json().catch(() => ({}))) as { title?: string };
    const title =
      typeof body.title === 'string' && body.title.trim().length > 0
        ? body.title.trim().slice(0, 200)
        : 'Untitled Collection';

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('collections')
      .insert({ owner_user_id: userId, title })
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);

    return Response.json({ collection: toCollection(data as Row) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
