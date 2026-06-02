import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertCollectionEditor } from '@/lib/collection-auth';
import { compactPositions } from '@/lib/collections';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ collectionId: string; itemId: string }> },
) {
  try {
    const { collectionId, itemId } = await params;
    const userId = await requireUserId(req);
    await assertCollectionEditor(collectionId, userId);

    const admin = getSupabaseAdmin();
    const { data: existing } = await admin
      .from('collection_items')
      .select('id, kind, collection_id')
      .eq('id', itemId)
      .maybeSingle();
    if (!existing || existing.collection_id !== collectionId) {
      return Response.json({ error: 'Item not found.' }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      caption?: string | null;
      textBody?: string | null;
    };
    const patch: Record<string, unknown> = {};

    if ('caption' in body && existing.kind === 'capture') {
      patch.caption = typeof body.caption === 'string' ? body.caption.slice(0, 2000) : null;
    }
    if ('textBody' in body && existing.kind === 'text') {
      if (typeof body.textBody !== 'string' || body.textBody.trim().length === 0) {
        return Response.json({ error: 'textBody cannot be empty' }, { status: 400 });
      }
      patch.text_body = body.textBody.slice(0, 10000);
    }
    if (Object.keys(patch).length === 0) {
      return Response.json({ ok: true, unchanged: true });
    }

    const { data, error } = await admin
      .from('collection_items').update(patch).eq('id', itemId)
      .select('id, collection_id, position, kind, node_id, caption, text_body, created_at')
      .single();
    if (error) throw new Error(error.message);

    await admin.from('collections')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', collectionId);

    return Response.json({ item: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized';
    return Response.json({ error: msg }, { status: 401 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ collectionId: string; itemId: string }> },
) {
  try {
    const { collectionId, itemId } = await params;
    const userId = await requireUserId(req);
    await assertCollectionEditor(collectionId, userId);

    const admin = getSupabaseAdmin();
    const { error: delErr } = await admin
      .from('collection_items').delete()
      .eq('id', itemId).eq('collection_id', collectionId);
    if (delErr) throw new Error(delErr.message);

    const { data: rest } = await admin
      .from('collection_items')
      .select('id, position')
      .eq('collection_id', collectionId)
      .order('position', { ascending: true });

    const compacted = compactPositions(
      (rest ?? []).map((r) => ({ id: r.id as string, position: r.position as number })),
    );
    for (const c of compacted) {
      await admin.from('collection_items').update({ position: c.position }).eq('id', c.id);
    }

    await admin.from('collections')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', collectionId);

    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized';
    return Response.json({ error: msg }, { status: 401 });
  }
}
