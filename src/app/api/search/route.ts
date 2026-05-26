import { requireUserId } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { groupSearchResults, sanitizeSearchTerm, type SearchCapture, type SearchInsight } from '@/lib/search';

const LIMIT = 60;

/**
 * GET /api/search?q=...
 * Searches captures + insights across every Mind the user belongs to (resolved
 * server-side from workspace_members — never a client-supplied id), text-match
 * only (v1). Returns results grouped by Mind.
 */
export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const raw = new URL(req.url).searchParams.get('q') ?? '';
    const term = sanitizeSearchTerm(raw);
    if (!term) return Response.json({ groups: [] });

    const db = getSupabaseAdmin();

    const { data: memberRows, error: mErr } = await db
      .from('workspace_members')
      .select('workspace_id, workspaces(id,name)')
      .eq('user_id', userId);
    if (mErr) return Response.json({ error: mErr.message }, { status: 500 });
    const minds = new Map<string, string>();
    for (const row of (memberRows ?? []) as unknown as { workspaces: { id: string; name: string } | null }[]) {
      if (row.workspaces) minds.set(row.workspaces.id, row.workspaces.name);
    }
    const ids = [...minds.keys()];
    if (!ids.length) return Response.json({ groups: [] });

    const like = `*${term}*`;
    const nodeOr = [
      `title.ilike.${like}`,
      `ai_summary.ilike.${like}`,
      `source_description.ilike.${like}`,
      `user_notes.ilike.${like}`,
      `raw_text.ilike.${like}`,
      `original_url.ilike.${like}`,
    ].join(',');

    const { data: nodeRows, error: nErr } = await db
      .from('nodes')
      .select('id,workspace_id,title,original_url,ai_summary')
      .in('workspace_id', ids)
      .or(nodeOr)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    if (nErr) return Response.json({ error: nErr.message }, { status: 500 });

    const { data: insightRows, error: iErr } = await db
      .from('insights')
      .select('id,workspace_id,title,body,source_kind')
      .in('workspace_id', ids)
      .or(`title.ilike.${like},body.ilike.${like}`)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    if (iErr) return Response.json({ error: iErr.message }, { status: 500 });

    const captures: SearchCapture[] = (nodeRows ?? []).map((n) => ({
      id: n.id as string,
      workspace_id: n.workspace_id as string,
      title: (n.title ?? null) as string | null,
      kind: 'capture',
      url: (n.original_url ?? null) as string | null,
      summary: (n.ai_summary ?? null) as string | null,
    }));
    const insights: SearchInsight[] = (insightRows ?? []).map((i) => {
      const body = (i.body ?? '') as string;
      return {
        id: i.id as string,
        workspace_id: i.workspace_id as string,
        title: (i.title ?? null) as string | null,
        kind: 'insight',
        snippet: body.length > 160 ? `${body.slice(0, 160).trim()}…` : body,
        source_kind: (i.source_kind ?? null) as string | null,
      };
    });

    return Response.json({ groups: groupSearchResults(captures, insights, minds) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
