import { generateText } from '@/lib/llm';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * Weekly consolidation of a Mind's distilled learnings (Hermes-pattern
 * curator). Cost-bounded:
 *   - one LLM call, ONLY when learnings have actually accumulated
 *     (>= CONSOLIDATE_THRESHOLD) — otherwise a cheap count query, no LLM;
 *   - re-grounds against SAMPLED RAW CAPTURES (anti-drift invariant): any
 *     learning not supported by real source material is dropped, so the
 *     pass can't become a self-reinforcing echo chamber;
 *   - replaces the set, capped at MAX_KEEP.
 * Caller gates on workspaces.learning_enabled + synthesis being enabled.
 */
const CONSOLIDATE_THRESHOLD = 12;
const MAX_KEEP = 20;
const SAMPLE_CAPTURES = 16;

type Learned = { id: string; body: string };

export async function consolidateMindLearnings(
  workspaceId: string,
): Promise<{ status: string; kept?: number }> {
  const admin = getSupabaseAdmin();

  const { data: learnedRows } = await admin
    .from('insights')
    .select('id,body')
    .eq('workspace_id', workspaceId)
    .eq('source_kind', 'learned')
    .order('created_at', { ascending: false });
  const learned = (learnedRows ?? []) as Learned[];
  if (learned.length < CONSOLIDATE_THRESHOLD) {
    return { status: 'skipped: below threshold' };
  }

  // Sample real source material to re-ground against (anti-drift).
  const { data: nodeRows } = await admin
    .from('nodes')
    .select('id,title,raw_text')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(SAMPLE_CAPTURES);
  const nodes = (nodeRows ?? []) as { id: string; title: string | null; raw_text: string | null }[];
  if (!nodes.length) return { status: 'skipped: no source material' };

  const sources = nodes
    .map(
      (n, i) =>
        `[${i + 1}] ${n.title ?? 'Untitled'}\n${(n.raw_text ?? '').replace(/\s+/g, ' ').slice(0, 400)}`,
    )
    .join('\n\n');
  const current = learned.map((l) => `- ${l.body}`).join('\n');

  const prompt = [
    `Sampled source material from this Mind, numbered for citation:\n\n${sources}`,
    '\n\n---\n\n',
    `The Mind's accumulated "learnings" so far:\n${current}`,
    '\n\n---\n\n',
    `Consolidate these learnings. Merge duplicates and near-duplicates, drop anything vague, and DROP ANY LEARNING NOT SUPPORTED BY THE SAMPLED SOURCE MATERIAL ABOVE — do not invent or extrapolate. Return at most ${MAX_KEEP} distinct, durable, source-grounded orientations, strongest first. One per line, each a standalone claim ≤200 chars, each ending with a single [n] citing the most load-bearing sampled source. Output only the lines, no preamble.`,
  ].join('');

  let out = '';
  try {
    out = await generateText({ prompt });
  } catch (e) {
    return { status: `skipped: LLM ${e instanceof Error ? e.message : 'error'}` };
  }

  const lines = out
    .split('\n')
    .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((l) => l.length > 15 && /\[\d+\]/.test(l))
    .slice(0, MAX_KEEP);
  if (!lines.length) return { status: 'skipped: empty consolidation' };

  const rows = lines.map((body) => {
    const m = body.match(/\[(\d+)\]/);
    const idx = m ? parseInt(m[1], 10) - 1 : -1;
    return {
      workspace_id: workspaceId,
      created_by: null,
      title: null,
      body: body.slice(0, 240),
      source_node_id: idx >= 0 && idx < nodes.length ? nodes[idx].id : null,
      source_kind: 'learned',
    };
  });

  // Replace the set atomically-ish: insert new, then delete the old ids.
  const oldIds = learned.map((l) => l.id);
  const { error: insErr } = await admin.from('insights').insert(rows);
  if (insErr) return { status: `skipped: insert ${insErr.message}` };
  await admin.from('insights').delete().in('id', oldIds);

  return { status: 'consolidated', kept: rows.length };
}
