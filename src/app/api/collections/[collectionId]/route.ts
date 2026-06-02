import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  assertCollectionEditor,
  assertCollectionOwner,
} from '@/lib/collection-auth';
import type {
  Collection, CollectionItem, CollectionItemKind,
  CollectionStatus, CollectionView,
} from '@/lib/collections';

interface CollectionRow {
  id: string; owner_user_id: string; title: string; description: string | null;
  cover_path: string | null; default_view: string; enabled_views: string[];
  show_summary: boolean; show_tags: boolean; show_notes: boolean;
  status: string; share_code: string | null;
  created_at: string; updated_at: string;
}
interface ItemRow {
  id: string; collection_id: string; position: number;
  kind: string; node_id: string | null;
  caption: string | null; text_body: string | null; created_at: string;
}
interface NodeJoinRow {
  id: string; title: string | null; original_url: string | null;
  og_image_url: string | null; media_path: string | null;
  scrape_kind: string | null; published_at: string | null;
  created_at: string; created_by: string | null;
  workspace_id: string;
}

const C_SELECT = 'id, owner_user_id, title, description, cover_path, default_view, enabled_views, show_summary, show_tags, show_notes, status, share_code, created_at, updated_at';
const ITEM_SELECT = 'id, collection_id, position, kind, node_id, caption, text_body, created_at';
const NODE_SELECT = 'id, title, original_url, og_image_url, media_path, scrape_kind, published_at, created_at, created_by, workspace_id';

function toCollection(r: CollectionRow): Collection {
  return {
    id: r.id, ownerUserId: r.owner_user_id, title: r.title, description: r.description,
    coverPath: r.cover_path, defaultView: r.default_view as CollectionView,
    enabledViews: r.enabled_views as CollectionView[],
    showSummary: r.show_summary, showTags: r.show_tags, showNotes: r.show_notes,
    status: r.status as CollectionStatus, shareCode: r.share_code,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toItem(r: ItemRow): CollectionItem {
  return {
    id: r.id, collectionId: r.collection_id, position: r.position,
    kind: r.kind as CollectionItemKind, nodeId: r.node_id,
    caption: r.caption, textBody: r.text_body, createdAt: r.created_at,
  };
}

const ALLOWED_VIEWS: CollectionView[] = ['editorial', 'gallery', 'timeline'];

function sanitizeEnabledViews(input: unknown): CollectionView[] | null {
  if (!Array.isArray(input)) return null;
  const valid: CollectionView[] = [];
  for (const v of input) {
    if (typeof v === 'string' && (ALLOWED_VIEWS as string[]).includes(v) && !valid.includes(v as CollectionView)) {
      valid.push(v as CollectionView);
    }
  }
  if (!valid.includes('editorial')) valid.unshift('editorial');
  return valid;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  try {
    const { collectionId } = await params;
    const userId = await requireUserId(req);
    const auth = await assertCollectionEditor(collectionId, userId);

    const admin = getSupabaseAdmin();
    const { data: cRow, error: cErr } = await admin
      .from('collections').select(C_SELECT).eq('id', collectionId).single();
    if (cErr || !cRow) throw new Error(cErr?.message ?? 'Collection not found');

    const { data: itemRows, error: iErr } = await admin
      .from('collection_items').select(ITEM_SELECT)
      .eq('collection_id', collectionId).order('position', { ascending: true });
    if (iErr) throw new Error(iErr.message);

    const items = ((itemRows ?? []) as ItemRow[]).map(toItem);
    const nodeIds = items.map((i) => i.nodeId).filter((x): x is string => !!x);

    const nodesById: Record<string, NodeJoinRow> = {};
    if (nodeIds.length) {
      const { data: nodes, error: nErr } = await admin
        .from('nodes').select(NODE_SELECT).in('id', nodeIds);
      if (nErr) throw new Error(nErr.message);
      for (const n of (nodes ?? []) as NodeJoinRow[]) nodesById[n.id] = n;
    }

    const { data: memberRows } = await admin
      .from('collection_members').select('user_id, role, invited_by, created_at')
      .eq('collection_id', collectionId);

    return Response.json({
      collection: toCollection(cRow as CollectionRow),
      isOwner: auth.isOwner,
      items: items.map((it) => ({
        ...it,
        node: it.nodeId ? nodesById[it.nodeId] ?? null : null,
      })),
      members: memberRows ?? [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized';
    return Response.json({ error: msg }, { status: 401 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  try {
    const { collectionId } = await params;
    const userId = await requireUserId(req);
    await assertCollectionEditor(collectionId, userId);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.title === 'string') patch.title = body.title.trim().slice(0, 200) || 'Untitled Collection';
    if (typeof body.description === 'string' || body.description === null) patch.description = body.description ?? null;
    if (typeof body.coverPath === 'string' || body.coverPath === null) patch.cover_path = body.coverPath ?? null;
    if (typeof body.defaultView === 'string' && (ALLOWED_VIEWS as string[]).includes(body.defaultView)) {
      patch.default_view = body.defaultView;
    }
    if ('enabledViews' in body) {
      const ev = sanitizeEnabledViews(body.enabledViews);
      if (ev) patch.enabled_views = ev;
    }
    if (typeof body.showSummary === 'boolean') patch.show_summary = body.showSummary;
    if (typeof body.showTags === 'boolean') patch.show_tags = body.showTags;
    if (typeof body.showNotes === 'boolean') patch.show_notes = body.showNotes;

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('collections').update(patch).eq('id', collectionId)
      .select(C_SELECT).single();
    if (error) throw new Error(error.message);
    return Response.json({ collection: toCollection(data as CollectionRow) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized';
    return Response.json({ error: msg }, { status: 401 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  try {
    const { collectionId } = await params;
    const userId = await requireUserId(req);
    await assertCollectionOwner(collectionId, userId);

    const admin = getSupabaseAdmin();
    const { error } = await admin.from('collections').delete().eq('id', collectionId);
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized';
    return Response.json({ error: msg }, { status: 401 });
  }
}
