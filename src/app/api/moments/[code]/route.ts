import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/moments/[code]
 * Public, unauthenticated. Resolves a Moment by its share_code and returns
 * only safe, display-only fields for the /m/<code> landing. Service role
 * read; never exposes membership, prompts, or captures.
 */
export async function GET(_req: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  if (!code) return Response.json({ error: 'not found' }, { status: 404 });

  const { data, error } = await getSupabaseAdmin()
    .from('workspaces')
    .select('id,name,description,event_mode,event_at,event_end_at,allow_anonymous_contributions')
    .eq('share_code', code)
    .maybeSingle();

  if (error) return Response.json({ error: 'lookup failed' }, { status: 500 });
  if (!data || !data.event_mode) {
    return Response.json({ error: 'This event link is not active.' }, { status: 404 });
  }

  return Response.json({
    moment: {
      name: data.name,
      description: data.description,
      eventAt: data.event_at,
      eventEndAt: data.event_end_at,
      allowAnonymous: data.allow_anonymous_contributions === true,
    },
  });
}
