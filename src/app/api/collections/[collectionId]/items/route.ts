import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertCollectionEditor } from '@/lib/collection-auth';
import { canAddCaptureToCollection } from '@/lib/collections';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  try {
    const { collectionId } = await params;
    const userId = await requireUserId(req);
    await assertCollectionEditor(collectionId, userId);

    const body = (await req.json().catch(() => ({}))) as {
      kind?: string; nodeId?: string; textBody?: string; caption?: string;
    };
    if (body.kind !== 'capture' && body.kind !== 'text') {
      return Response.json({ error: 'kind must be "capture" or "text"' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    if (body.kind === 'capture') {
      if (!body.nodeId || typeof body.nodeId !== 'string') {
        return Response.json({ error: 'nodeId is required for capture items' }, { status: 400 });
      }

      const { data: node, error: nodeErr } = await admin
        .from('nodes')
        .select('id, workspace_id, created_by')
        .eq('id', body.nodeId).maybeSingle();
      if (nodeErr) throw new Error(nodeErr.message);
      if (!node) return Response.json({ error: 'Capture not found.' }, { status: 404 });

      // Caller must be a member of the source Mind at add-time.
      const { data: memberRow } = await admin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', node.workspace_id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!memberRow) {
        return Response.json({ error: 'Not a member of the source Mind.' }, { status: 403 });
      }

      const { data: ws, error: wsErr } = await admin
        .from('workspaces')
        .select('allow_member_cross_publish')
        .eq('id', node.workspace_id).single();
      if (wsErr || !ws) return Response.json({ error: 'Source Mind not found.' }, { status: 404 });

      const decision = canAddCaptureToCollection({
        actorUserId: userId,
        nodeCreatedBy: node.created_by ?? userId,
        workspaceAllowMemberCrossPublish: ws.allow_member_cross_publish === true,
      });
      if (!decision.ok) {
        return Response.json(
          { error: 'This Mind only allows adding your own captures to Collections.' },
          { status: 403 },
        );
      }
    } else {
      if (typeof body.textBody !== 'string' || body.textBody.trim().length === 0) {
        return Response.json({ error: 'textBody is required for text items' }, { status: 400 });
      }
    }

    // Compute the next position (append).
    const { data: last } = await admin
      .from('collection_items')
      .select('position')
      .eq('collection_id', collectionId)
      .order('position', { ascending: false })
      .limit(1).maybeSingle();
    const nextPosition = ((last?.position as number | undefined) ?? -1) + 1;

    const insertRow = {
      collection_id: collectionId,
      position: nextPosition,
      kind: body.kind,
      node_id: body.kind === 'capture' ? body.nodeId! : null,
      caption: body.kind === 'capture' && typeof body.caption === 'string'
        ? body.caption.slice(0, 2000) : null,
      text_body: body.kind === 'text' ? body.textBody!.slice(0, 10000) : null,
    };

    const { data, error } = await admin
      .from('collection_items').insert(insertRow)
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
