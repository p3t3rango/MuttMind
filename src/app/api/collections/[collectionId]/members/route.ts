import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertCollectionOwner } from '@/lib/collection-auth';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  try {
    const { collectionId } = await params;
    const userId = await requireUserId(req);
    await assertCollectionOwner(collectionId, userId);

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('collection_members')
      .select('user_id, role, invited_by, created_at')
      .eq('collection_id', collectionId);
    if (error) throw new Error(error.message);
    return Response.json({ members: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized';
    return Response.json({ error: msg }, { status: 401 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  try {
    const { collectionId } = await params;
    const userId = await requireUserId(req);
    await assertCollectionOwner(collectionId, userId);

    const body = (await req.json().catch(() => ({}))) as { email?: string };
    if (typeof body.email !== 'string' || !body.email.includes('@')) {
      return Response.json({ error: 'email is required' }, { status: 400 });
    }
    const email = body.email.trim().toLowerCase();

    const admin = getSupabaseAdmin();
    const { data: user } = await admin
      .from('users').select('id').eq('email', email).maybeSingle();
    if (!user) return Response.json({ error: 'No MuttMind account for that email.' }, { status: 404 });
    if ((user.id as string) === userId) {
      return Response.json({ error: 'You are already the owner.' }, { status: 409 });
    }

    const { error: insErr } = await admin
      .from('collection_members')
      .insert({
        collection_id: collectionId,
        user_id: user.id,
        role: 'editor',
        invited_by: userId,
      });
    if (insErr) {
      if ((insErr as { code?: string }).code === '23505') {
        return Response.json({ error: 'Already an editor.' }, { status: 409 });
      }
      throw new Error(insErr.message);
    }
    return Response.json({ ok: true });
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

    const body = (await req.json().catch(() => ({}))) as { userId?: string };
    if (typeof body.userId !== 'string') {
      return Response.json({ error: 'userId is required' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('collection_members').delete()
      .eq('collection_id', collectionId).eq('user_id', body.userId);
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized';
    return Response.json({ error: msg }, { status: 401 });
  }
}
