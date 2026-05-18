import { captureSignal } from '@/lib/capture';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/moments/[code]/capture
 *
 * The ONLY unauthenticated write path in the app. Hard-gated:
 *   - the share_code must resolve to a workspace
 *   - that workspace must have event_mode AND allow_anonymous_contributions
 * Anonymous captures are credited to the Moment's owner (nodes.created_by is
 * NOT NULL; owner is always a member so the normal capture path's membership
 * check passes). Size-capped. Per-IP rate limiting needs a shared store
 * (none provisioned) — tracked as a follow-up, not faked here.
 */
const MAX_TEXT = 20_000;
const MAX_URL = 2_000;

export async function POST(req: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    if (!code) return Response.json({ error: 'not found' }, { status: 404 });

    const { data: ws, error } = await getSupabaseAdmin()
      .from('workspaces')
      .select('id,event_mode,allow_anonymous_contributions')
      .eq('share_code', code)
      .maybeSingle();
    if (error) return Response.json({ error: 'lookup failed' }, { status: 500 });
    if (!ws || !ws.event_mode) {
      return Response.json({ error: 'This event link is not active.' }, { status: 404 });
    }
    if (ws.allow_anonymous_contributions !== true) {
      return Response.json(
        { error: 'This Moment is not accepting open contributions.' },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const url = typeof body?.url === 'string' ? body.url.trim().slice(0, MAX_URL) : undefined;
    const rawText =
      typeof body?.rawText === 'string' ? body.rawText.slice(0, MAX_TEXT) : undefined;
    if (!url && !rawText) {
      return Response.json({ error: 'Add a link or some text.' }, { status: 400 });
    }

    // Credit anonymous contributions to the Moment owner so created_by stays
    // valid and the normal membership check passes.
    const { data: owner } = await getSupabaseAdmin()
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', ws.id)
      .eq('role', 'owner')
      .maybeSingle();
    if (!owner?.user_id) {
      return Response.json({ error: 'Moment is misconfigured (no owner).' }, { status: 500 });
    }

    const result = await captureSignal({
      userId: owner.user_id,
      workspaceId: ws.id,
      url,
      rawText,
    });
    return Response.json({ ok: true, nodeId: result.nodeId });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
